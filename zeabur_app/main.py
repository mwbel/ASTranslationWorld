from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import oss2
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tibetan_ocr_bridge import call_ai_ocr
from tibetan_translation_bridge import call_translation


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


OSS_ENDPOINT = env("OSS_ENDPOINT")
OSS_BUCKET = env("OSS_BUCKET")
OSS_ACCESS_KEY_ID = env("OSS_ACCESS_KEY_ID")
OSS_ACCESS_KEY_SECRET = env("OSS_ACCESS_KEY_SECRET")
OSS_PREFIX = env("OSS_PREFIX", "tibetan-proofreading").strip("/")
BDRC_OCR_UPSTREAM_URL = env("BDRC_OCR_UPSTREAM_URL")
MAX_UPLOAD_BYTES = int(env("MAX_UPLOAD_BYTES", str(200 * 1024 * 1024)))


def oss_bucket() -> oss2.Bucket:
    missing = [name for name, value in {
        "OSS_ENDPOINT": OSS_ENDPOINT,
        "OSS_BUCKET": OSS_BUCKET,
        "OSS_ACCESS_KEY_ID": OSS_ACCESS_KEY_ID,
        "OSS_ACCESS_KEY_SECRET": OSS_ACCESS_KEY_SECRET,
    }.items() if not value]
    if missing:
        raise HTTPException(503, f"OSS 尚未配置：{', '.join(missing)}")
    return oss2.Bucket(oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET), OSS_ENDPOINT, OSS_BUCKET)


def object_key(book_id: str, suffix: str) -> str:
    return f"{OSS_PREFIX}/books/{book_id}/{suffix.lstrip('/')}"


def write_json(book_id: str, suffix: str, payload: dict[str, Any]) -> None:
    oss_bucket().put_object(
        object_key(book_id, suffix),
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
    )


def read_json(book_id: str, suffix: str) -> dict[str, Any]:
    try:
        body = oss_bucket().get_object(object_key(book_id, suffix)).read()
    except oss2.exceptions.NoSuchKey as exc:
        raise HTTPException(404, "书籍或校对状态不存在") from exc
    return json.loads(body.decode("utf-8"))


app = FastAPI(title="Tibetan OCR Proofreading Workbench", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    oss_configured = all((OSS_ENDPOINT, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET))
    return {
        "ok": oss_configured,
        "service": "tibetan-proofreading-zeabur",
        "oss": {"configured": oss_configured, "bucket": OSS_BUCKET, "prefix": OSS_PREFIX},
        "bdrc": {"configured": bool(BDRC_OCR_UPSTREAM_URL), "upstream": BDRC_OCR_UPSTREAM_URL},
        "ai_ocr": {"configured": bool(env("MODEL_AGGREGATOR_BASE_URL") or env("AI_VISION_BASE_URL"))},
        "translation": {"provider": env("TRANSLATE_PROVIDER", "model_aggregator")},
    }


@app.post("/api/books")
async def create_book(file: UploadFile = File(...)) -> dict[str, Any]:
    content = await file.read()
    if not content:
        raise HTTPException(400, "上传文件为空")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"文件超过上限 {MAX_UPLOAD_BYTES} bytes")
    book_id = uuid.uuid4().hex
    safe_name = Path(file.filename or "book.bin").name
    created_at = datetime.now(timezone.utc).isoformat()
    source_key = object_key(book_id, f"source/{safe_name}")
    oss_bucket().put_object(source_key, content, headers={"Content-Type": file.content_type or "application/octet-stream"})
    metadata = {
        "book_id": book_id,
        "name": safe_name,
        "size": len(content),
        "content_type": file.content_type or "application/octet-stream",
        "source_key": source_key,
        "created_at": created_at,
        "updated_at": created_at,
    }
    write_json(book_id, "metadata.json", metadata)
    write_json(book_id, "state.json", {**metadata, "page_count": 0, "ocr_results": {}, "translation_results": {}})
    return metadata


@app.get("/api/books/{book_id}/state")
def get_book_state(book_id: str) -> dict[str, Any]:
    return read_json(book_id, "state.json")


@app.put("/api/books/{book_id}/state")
async def put_book_state(book_id: str, request: Request) -> dict[str, Any]:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(400, "状态必须是 JSON object")
    payload["book_id"] = book_id
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    write_json(book_id, "state.json", payload)
    return {"ok": True, "book_id": book_id, "updated_at": payload["updated_at"]}


@app.post("/api/books/{book_id}/exports")
async def save_export(book_id: str, request: Request) -> dict[str, Any]:
    payload = await request.json()
    text = str(payload.get("text") or "")
    kind = str(payload.get("kind") or "markdown").replace("/", "-")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    key = object_key(book_id, f"exports/{timestamp}-{kind}.md")
    oss_bucket().put_object(key, text.encode("utf-8"), headers={"Content-Type": "text/markdown; charset=utf-8"})
    return {"ok": True, "book_id": book_id, "object_key": key}


@app.post("/api/ocr")
async def bdrc_ocr(file: UploadFile = File(...)) -> JSONResponse:
    if not BDRC_OCR_UPSTREAM_URL:
        raise HTTPException(503, "BDRC_OCR_UPSTREAM_URL 未配置；云端 BDRC 初稿当前不可用")
    content = await file.read()
    boundary = uuid.uuid4().hex
    filename = Path(file.filename or "page.png").name
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
        f"Content-Type: {file.content_type or 'image/png'}\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(BDRC_OCR_UPSTREAM_URL, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req, timeout=180) as response:
            return JSONResponse(json.loads(response.read().decode("utf-8")))
    except (urllib.error.URLError, urllib.error.HTTPError) as exc:
        raise HTTPException(502, f"BDRC OCR 上游调用失败：{exc}") from exc


@app.post("/api/ai-ocr")
async def ai_ocr(
    file: UploadFile = File(...),
    ocr_text: str = Form(""),
    prompt: str = Form(""),
) -> dict[str, Any]:
    return call_ai_ocr(await file.read(), file.filename or "page.png", ocr_text, prompt)


@app.post("/api/translate")
async def translate(request: Request) -> dict[str, Any]:
    payload = await request.json()
    return call_translation(payload)


@app.get("/")
def root() -> RedirectResponse:
    return RedirectResponse("/tibetan-proofreading-app/")


app.mount("/tibetan-proofreading-app", StaticFiles(directory=ROOT / "tibetan-proofreading-app", html=True), name="workbench")

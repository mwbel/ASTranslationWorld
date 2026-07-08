from __future__ import annotations

import json
import os
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from adapter_server.auth import authenticate_login, require_user_from_request
from adapter_server.models import list_models, model_response
from adapter_server.providers import ProviderError, generate_text
from common.config import AppConfig, load_config
from common.redaction import decode_body_sample, redact_headers, redact_obj


CONFIG_PATH = Path(os.environ.get("ADAPTER_CONFIG", "config.yaml"))
DATA_DIR = Path(os.environ.get("ADAPTER_DATA_DIR", "data/adapter"))
UNKNOWN_DIR = DATA_DIR / "unknown-requests"
CALL_LOG = DATA_DIR / "calls.jsonl"

app = FastAPI(title="AS Yilin Model Adapter", version="0.1.0")
config: AppConfig | None = None


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def get_config() -> AppConfig:
    global config
    if config is None:
        config = load_config(CONFIG_PATH)
    return config


def write_call(record: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with CALL_LOG.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")


async def payload_from_request(request: Request) -> dict[str, Any]:
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            raw = await request.json()
            return raw if isinstance(raw, dict) else {"value": raw}
        except Exception:
            return {}
    body = await request.body()
    if not body:
        return {}
    try:
        raw = json.loads(body.decode("utf-8"))
        return raw if isinstance(raw, dict) else {"value": raw}
    except Exception:
        return {"raw_body": body.decode("utf-8", errors="replace")}


def adapter_models_response(request_models: list[dict[str, Any]]) -> JSONResponse:
    return JSONResponse(model_response(request_models))


def extract_response_text(result: dict[str, Any]) -> str:
    for key in ("text", "content", "translation", "answer", "translated_text", "output"):
        value = result.get(key)
        if isinstance(value, str):
            return value

    try:
        content = result["choices"][0]["message"]["content"]
        if isinstance(content, str):
            return content
    except Exception:
        pass

    message = result.get("message")
    if isinstance(message, dict):
        content = message.get("content")
        if isinstance(content, str):
            return content

    return ""


def openai_stream_response(result: dict[str, Any], payload: dict[str, Any], request_id: str) -> StreamingResponse:
    content = extract_response_text(result)
    model = str(payload.get("model") or payload.get("model_id") or result.get("model") or "adapter-model")
    created = int(time.time())

    async def events() -> AsyncIterator[str]:
        if content:
            chunk = {
                "id": f"chatcmpl-{request_id}",
                "object": "chat.completion.chunk",
                "created": created,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"content": content},
                        "finish_reason": None,
                    }
                ],
            }
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

        done_chunk = {
            "id": f"chatcmpl-{request_id}",
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "delta": {},
                    "finish_reason": result.get("finish_reason") or "stop",
                }
            ],
        }
        yield f"data: {json.dumps(done_chunk, ensure_ascii=False)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "cache-control": "no-cache",
            "x-adapter-request-id": request_id,
        },
    )


@app.on_event("startup")
async def startup() -> None:
    get_config()


@app.get("/health")
async def health() -> dict[str, Any]:
    cfg = get_config()
    return {
        "ok": True,
        "service": "adapter-server",
        "time": utc_now(),
        "models": len(cfg.adapter.models),
        "providers": len(cfg.adapter.providers),
        "users": len(cfg.adapter.users),
    }


@app.post("/auth/login")
@app.post("/login")
@app.post("/api/auth/login")
@app.post("/v1/auth/login")
async def login(request: Request) -> dict[str, Any]:
    payload = await payload_from_request(request)
    return authenticate_login(get_config(), payload)


@app.get("/models")
@app.get("/api/models")
@app.get("/v1/models")
@app.get("/gv/models")
@app.get("/api/gv/models")
async def models(request: Request) -> JSONResponse:
    user = await require_user_from_request(request, get_config())
    return adapter_models_response(list_models(get_config(), user))


@app.post("/chat/completions")
@app.post("/v1/chat/completions")
@app.post("/completions")
@app.post("/v1/completions")
@app.post("/translate")
@app.post("/api/translate")
@app.post("/generate")
@app.post("/api/generate")
async def completions(request: Request) -> JSONResponse:
    cfg = get_config()
    await require_user_from_request(request, cfg)
    payload = await payload_from_request(request)
    request_id = str(uuid4())
    started_at = utc_now()
    try:
        result = await generate_text(cfg, payload)
        write_call(
            {
                "timestamp": started_at,
                "request_id": request_id,
                "status": "ok",
                "model": payload.get("model") or payload.get("model_id"),
                "usage": result.get("usage", {}),
            }
        )
        if payload.get("stream") is True:
            return openai_stream_response(result, payload, request_id)
        response = JSONResponse(result)
        response.headers["x-adapter-request-id"] = request_id
        return response
    except (ProviderError, ValueError) as exc:
        write_call(
            {
                "timestamp": started_at,
                "request_id": request_id,
                "status": "error",
                "error": str(exc),
                "payload": redact_obj(payload),
            }
        )
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.get("/admin/calls")
async def recent_calls(limit: int = 50) -> dict[str, Any]:
    if not CALL_LOG.exists():
        return {"items": []}
    lines = CALL_LOG.read_text(encoding="utf-8").splitlines()
    items = [json.loads(line) for line in lines[-limit:] if line.strip()]
    return {"items": items, "total_returned": len(items)}


async def capture_unknown(path: str, request: Request) -> JSONResponse:
    body_bytes = await request.body()
    record = {
        "timestamp": utc_now(),
        "request_id": str(uuid4()),
        "method": request.method,
        "path": "/" + path,
        "query": dict(request.query_params),
        "headers": redact_headers(dict(request.headers)),
        "body": decode_body_sample(body_bytes, request.headers.get("content-type")),
    }
    UNKNOWN_DIR.mkdir(parents=True, exist_ok=True)
    out = UNKNOWN_DIR / f"{record['timestamp'].replace(':', '-')}_{record['request_id']}.json"
    out.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")

    lowered = record["path"].lower()
    if "model" in lowered:
        try:
            user = await require_user_from_request(request, get_config())
        except HTTPException:
            user = None
        return adapter_models_response(list_models(get_config(), user))
    if any(key in lowered for key in ("login", "auth", "token")) and request.method == "POST":
        payload = await payload_from_request(request)
        return JSONResponse(authenticate_login(get_config(), payload))
    return JSONResponse(
        {
            "ok": False,
            "error": "Unknown adapter route captured for protocol mapping",
            "request_id": record["request_id"],
        },
        status_code=404,
    )


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def catch_all(path: str, request: Request) -> Response:
    if request.method == "OPTIONS":
        return Response(
            status_code=204,
            headers={
                "access-control-allow-origin": "*",
                "access-control-allow-methods": "*",
                "access-control-allow-headers": "*",
            },
        )
    return await capture_unknown(path, request)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("adapter_server.app:app", host="0.0.0.0", port=18081, reload=False)

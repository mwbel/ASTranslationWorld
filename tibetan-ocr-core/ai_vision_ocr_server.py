#!/usr/bin/env python3
"""Local AI Vision OCR adapter for Tibetan OCR correction.

This service exposes the same lightweight HTTP shape as the local BDRC wrapper:

- GET /health
- POST /ocr with multipart field "file"

It forwards the rendered page image plus optional BDRC OCR draft text to either
ModelAggregatorService or an OpenAI-compatible vision chat-completions endpoint.
"""

from __future__ import annotations

import base64
import cgi
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


HOST = os.environ.get("AI_VISION_OCR_HOST", "127.0.0.1")
PORT = int(os.environ.get("AI_VISION_OCR_PORT", "18092"))
PROVIDER = os.environ.get("AI_VISION_PROVIDER", "model_aggregator").strip().lower()
USE_MODEL_AGGREGATOR = PROVIDER in {"model_aggregator", "model-aggregator", "aggregator"}
BASE_URL = os.environ.get("AI_VISION_BASE_URL", "http://127.0.0.1:11434/v1").rstrip("/")
API_KEY = os.environ.get("AI_VISION_API_KEY", "")
AGGREGATOR_BASE_URL = os.environ.get("MODEL_AGGREGATOR_BASE_URL", "http://127.0.0.1:8890").rstrip("/")
AGGREGATOR_API_KEY = os.environ.get("MODEL_AGGREGATOR_API_KEY", "")
DEFAULT_MODEL = "gemini:gemini-2.5-flash" if USE_MODEL_AGGREGATOR else "qwen2.5-vl:7b"
MODEL = os.environ.get("AI_VISION_MODEL", DEFAULT_MODEL)
TIMEOUT = float(os.environ.get("AI_VISION_TIMEOUT", "120"))
MAX_TOKENS = int(os.environ.get("AI_VISION_MAX_TOKENS", "8192"))
TEMPERATURE = float(os.environ.get("AI_VISION_TEMPERATURE", "0.0"))
AGGREGATOR_ALLOW_FALLBACK = os.environ.get("AI_VISION_ALLOW_FALLBACK", "0").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}


def parse_model_list(value: str) -> list[str]:
    value = value.strip()
    if not value:
        return []
    if value.startswith("["):
        parsed = json.loads(value)
        return [str(item).strip() for item in parsed if str(item).strip()]
    return [item.strip() for item in value.split(",") if item.strip()]


AGGREGATOR_MODELS = parse_model_list(os.environ.get("AI_VISION_MODELS", ""))


def chat_completions_url() -> str:
    if BASE_URL.endswith("/chat/completions"):
        return BASE_URL
    return f"{BASE_URL}/chat/completions"


def aggregator_url(path: str) -> str:
    return f"{AGGREGATOR_BASE_URL}/{path.lstrip('/')}"


def default_prompt(draft_text: str) -> str:
    draft_lines = [line for line in draft_text.splitlines() if line.strip()]
    parts = [
        "请识别图片中的藏文印刷体文字。",
        "重点检查上加字、下加字、元音符号和堆叠字。",
        "不要根据语义自由扩写，不要补充图片中不存在的字。",
    ]
    if draft_text:
        parts.append(
            f"BDRC OCR 初稿共有 {len(draft_lines)} 行。请必须输出 {len(draft_lines)} 行，用换行逐行分隔；不得只输出前几行。"
        )
        parts.append("看不清或无法确认的行，请保留 BDRC 原行，只修正有图像证据的字。")
        parts.append("下面是 BDRC OCR 初稿。请以图片为准，只修正有视觉证据的错误：")
        parts.append(draft_text)
    else:
        parts.append("请完整输出整页所有藏文行，用换行逐行分隔；不得只输出前几行。")
    parts.append("只输出纯藏文文本，不要输出编号、解释、Markdown 表格或代码块。")
    return "\n\n".join(parts)


def image_data_url(image_bytes: bytes, filename: str) -> str:
    mime_type = mimetypes.guess_type(filename)[0] or "image/png"
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def parse_model_text(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("text"), str):
        return payload["text"]
    if isinstance(payload.get("output"), str):
        return payload["output"]

    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            chunks = []
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    chunks.append(item["text"])
            if chunks:
                return "\n".join(chunks)

    return json.dumps(payload, ensure_ascii=False)


def post_json(url: str, body: dict[str, Any], api_key: str = "") -> dict[str, Any]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"AI Vision upstream HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"AI Vision upstream unavailable: {exc.reason}") from exc

    return json.loads(response_body)


def get_json(url: str, api_key: str = "", timeout: float = 3.0) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"}, method="GET")
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"unavailable: {exc.reason}") from exc

    return json.loads(response_body)


def summarize_attempts(attempts: Any) -> str:
    if not isinstance(attempts, list) or not attempts:
        return ""
    chunks: list[str] = []
    for attempt in attempts[:4]:
        if not isinstance(attempt, dict):
            continue
        model = attempt.get("modelRef") or attempt.get("model") or "model"
        status = attempt.get("status") or "unknown"
        error = attempt.get("error")
        chunks.append(f"{model}: {status}" + (f" ({redact_sensitive(str(error))})" if error else ""))
    return "；".join(chunks)


def redact_sensitive(text: str) -> str:
    redacted = text
    redacted = re.sub(r"([?&]key=)[^&\s)]+", r"\1***REDACTED***", redacted)
    redacted = re.sub(r"(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+", r"\1***REDACTED***", redacted)
    redacted = re.sub(r"AIza[0-9A-Za-z_-]{20,}", "***REDACTED***", redacted)
    return redacted


def call_model_aggregator(image_bytes: bytes, filename: str, prompt: str) -> dict[str, Any]:
    data_url = image_data_url(image_bytes, filename)
    upload = post_json(
        aggregator_url("/api/aggregate/upload"),
        {
            "name": filename,
            "kind": "image",
            "mimeType": mimetypes.guess_type(filename)[0] or "image/png",
            "size": len(image_bytes),
            "dataUrl": data_url,
        },
        AGGREGATOR_API_KEY,
    )
    if not upload.get("ok") or not upload.get("id"):
        raise RuntimeError(f"ModelAggregator upload failed: {upload.get('error') or upload}")

    request_body: dict[str, Any] = {
        "attachmentIds": [upload["id"]],
        "prompt": prompt,
        "allowFallback": AGGREGATOR_ALLOW_FALLBACK,
        "maxTokens": MAX_TOKENS,
        "temperature": TEMPERATURE,
    }
    if AGGREGATOR_MODELS:
        request_body["models"] = AGGREGATOR_MODELS
    else:
        request_body["model"] = MODEL

    raw = post_json(
        aggregator_url("/api/aggregate/image-to-markdown"),
        request_body,
        AGGREGATOR_API_KEY,
    )
    if not raw.get("ok"):
        attempts = summarize_attempts(raw.get("attempts"))
        detail = raw.get("error") or "image-to-markdown failed"
        if attempts:
            detail = f"{detail}；{attempts}"
        raise RuntimeError(f"ModelAggregator image OCR failed: {redact_sensitive(detail)}")

    resolved_model = str(raw.get("modelRef") or raw.get("model") or MODEL).strip()
    resolved_provider = str(raw.get("provider") or "").strip().lower()
    if resolved_provider == "mathpix" or "mathpix" in resolved_model.lower():
        attempts = summarize_attempts(raw.get("attempts"))
        detail = "AI Vision 已拒绝 Mathpix 回退：Mathpix 面向数学公式，不用于藏文 OCR。"
        if attempts:
            detail = f"{detail}；上游尝试：{attempts}"
        raise RuntimeError(detail)

    text = str(raw.get("markdown") or raw.get("answer") or raw.get("text") or "").strip()
    return {
        "text": text,
        "lines": [{"text": line} for line in text.splitlines() if line.strip()],
        "raw": raw,
        "model": resolved_model,
        "provider": "model_aggregator",
        "upstream": aggregator_url("/api/aggregate/image-to-markdown"),
    }


def call_openai_compatible(image_bytes: bytes, filename: str, prompt: str) -> dict[str, Any]:
    body = {
        "model": MODEL,
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {"url": image_data_url(image_bytes, filename)},
                    },
                ],
            }
        ],
    }
    raw = post_json(chat_completions_url(), body, API_KEY)
    text = parse_model_text(raw).strip()
    return {
        "text": text,
        "lines": [{"text": line} for line in text.splitlines() if line.strip()],
        "raw": raw,
        "model": MODEL,
        "provider": "openai-compatible",
        "upstream": chat_completions_url(),
    }


def call_vision_model(image_bytes: bytes, filename: str, prompt: str) -> dict[str, Any]:
    if USE_MODEL_AGGREGATOR:
        return call_model_aggregator(image_bytes, filename, prompt)
    return call_openai_compatible(image_bytes, filename, prompt)


def health_payload() -> dict[str, Any]:
    if USE_MODEL_AGGREGATOR:
        upstream_health_url = aggregator_url("/api/aggregate/health")
        upstream_ok = False
        upstream_error = ""
        upstream_payload: dict[str, Any] = {}
        try:
            upstream_payload = get_json(upstream_health_url, AGGREGATOR_API_KEY)
            upstream_ok = bool(upstream_payload.get("ok", True))
        except Exception as exc:
            upstream_error = redact_sensitive(str(exc))

        return {
            "ok": upstream_ok,
            "model": MODEL,
            "models": AGGREGATOR_MODELS or [MODEL],
            "allow_fallback": AGGREGATOR_ALLOW_FALLBACK,
            "base_url": AGGREGATOR_BASE_URL,
            "upstream": aggregator_url("/api/aggregate/image-to-markdown"),
            "upstream_health": upstream_health_url,
            "upstream_ok": upstream_ok,
            "upstream_error": upstream_error,
            "upstream_payload": upstream_payload,
            "has_api_key": bool(AGGREGATOR_API_KEY),
            "provider": "model_aggregator",
        }
    return {
        "ok": True,
        "model": MODEL,
        "base_url": BASE_URL,
        "upstream": chat_completions_url(),
        "has_api_key": bool(API_KEY),
        "provider": "openai-compatible",
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "AIVisionOCRLocal/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            payload = health_payload()
            self.send_json(payload, status=200 if payload.get("ok") else 503)
            return
        self.send_json({"error": "Not found"}, status=404)

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/ocr":
            self.send_json({"error": "Not found"}, status=404)
            return

        try:
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                    "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
                },
            )
            if "file" not in form:
                raise RuntimeError('multipart field "file" is required')

            file_item = form["file"]
            image_bytes = file_item.file.read()
            if not image_bytes:
                raise RuntimeError("uploaded file is empty")

            filename = getattr(file_item, "filename", "") or "page.png"
            draft_text = field_value(form, "ocr_text")
            prompt = field_value(form, "prompt") or default_prompt(draft_text)
            payload = call_vision_model(image_bytes, filename, prompt)
            self.send_json(payload)
        except Exception as exc:
            self.send_json({"error": redact_sensitive(str(exc))}, status=500)

    def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))


def field_value(form: cgi.FieldStorage, name: str) -> str:
    if name not in form:
        return ""
    item = form[name]
    if isinstance(item, list):
        item = item[0]
    value = item.value
    return value if isinstance(value, str) else ""


def main() -> None:
    print(f"AI Vision OCR local server: http://{HOST}:{PORT}")
    print(f"provider={health_payload()['provider']}")
    print(f"upstream={health_payload()['upstream']}")
    print(f"model={MODEL}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()

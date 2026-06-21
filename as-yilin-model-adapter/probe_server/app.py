from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, PlainTextResponse, StreamingResponse

from common.redaction import decode_body_sample, redact_headers, redact_obj


DATA_DIR = Path(os.environ.get("PROBE_DATA_DIR", "data/probe"))
REQUESTS_DIR = DATA_DIR / "captured-requests"
INDEX_PATH = DATA_DIR / "requests.jsonl"

app = FastAPI(title="AS Yilin Protocol Probe", version="0.1.0")


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


def ensure_dirs() -> None:
    REQUESTS_DIR.mkdir(parents=True, exist_ok=True)


def write_capture(record: dict[str, Any]) -> None:
    ensure_dirs()
    request_id = record["request_id"]
    detail_path = REQUESTS_DIR / f"{record['timestamp'].replace(':', '-')}_{request_id}.json"
    detail_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")

    index_record = {
        "timestamp": record["timestamp"],
        "request_id": request_id,
        "method": record["method"],
        "path": record["path"],
        "query": record["query"],
        "content_type": record["body"].get("content_type"),
        "body_kind": record["body"].get("kind"),
        "body_size_bytes": record["body"].get("size_bytes"),
        "detail_path": str(detail_path),
    }
    with INDEX_PATH.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(index_record, ensure_ascii=False) + "\n")


def probe_models() -> list[dict[str, Any]]:
    return [
        {
            "id": "probe-quality-model",
            "model_id": "probe-quality-model",
            "name": "Probe Quality Model",
            "display_name": "Probe Quality Model",
            "category": "quality_translation",
            "model_category": "quality_translation",
            "supports_stream": True,
            "supports_vision": False,
            "context_window": 8192,
        },
        {
            "id": "probe-vision-model",
            "model_id": "probe-vision-model",
            "name": "Probe Vision Model",
            "display_name": "Probe Vision Model",
            "category": "multimodal_vision",
            "model_category": "multimodal_vision",
            "supports_stream": False,
            "supports_vision": True,
            "context_window": 8192,
        },
    ]


def guessed_response(path: str, method: str, body: dict[str, Any]) -> Response:
    lowered = path.lower()

    if "stream" in lowered:
        async def stream():
            yield "data: " + json.dumps({"content": "probe stream response"}, ensure_ascii=False) + "\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    if any(key in lowered for key in ("login", "auth", "token", "session")):
        return JSONResponse(
            {
                "ok": True,
                "token": "probe-token",
                "access_token": "probe-token",
                "expires_at": "2099-01-01T00:00:00Z",
                "token_expires_at": "2099-01-01T00:00:00Z",
                "user": {
                    "id": "probe-user",
                    "username": "probe-user",
                    "display_name": "Probe User",
                },
            }
        )

    if "model" in lowered:
        return JSONResponse({"models": probe_models(), "data": probe_models(), "items": probe_models()})

    if any(key in lowered for key in ("chat", "completion", "translate", "generate", "literal")):
        return JSONResponse(
            {
                "text": "probe generated text",
                "content": "probe generated text",
                "translation": "probe generated text",
                "message": {"role": "assistant", "content": "probe generated text"},
                "choices": [{"message": {"role": "assistant", "content": "probe generated text"}}],
                "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
            }
        )

    if method == "GET":
        return JSONResponse({"ok": True, "probe": True, "path": path})

    return JSONResponse({"ok": True, "probe": True, "received": redact_obj(body)})


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"ok": True, "service": "probe-server", "time": utc_now()}


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def capture(path: str, request: Request) -> Response:
    body_bytes = await request.body()
    content_type = request.headers.get("content-type")
    body = decode_body_sample(body_bytes, content_type)
    request_id = str(uuid4())
    full_path = "/" + path

    record = {
        "timestamp": utc_now(),
        "request_id": request_id,
        "client": request.client.host if request.client else None,
        "method": request.method,
        "path": full_path,
        "query": dict(request.query_params),
        "headers": redact_headers(dict(request.headers)),
        "body": body,
    }
    write_capture(record)

    if request.method == "OPTIONS":
        return Response(
            status_code=204,
            headers={
                "access-control-allow-origin": "*",
                "access-control-allow-methods": "*",
                "access-control-allow-headers": "*",
            },
        )

    if request.method == "HEAD":
        return Response(status_code=200, headers={"x-probe-request-id": request_id})

    response = guessed_response(full_path, request.method, body)
    response.headers["x-probe-request-id"] = request_id
    return response


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("probe_server.app:app", host="0.0.0.0", port=18080, reload=False)

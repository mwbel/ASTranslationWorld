from __future__ import annotations

import base64
import json
from typing import Any


SENSITIVE_KEY_PARTS = (
    "authorization",
    "password",
    "passwd",
    "secret",
    "token",
    "api_key",
    "apikey",
    "access_key",
    "refresh",
    "credential",
    "cookie",
)


def is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    return any(part in lowered for part in SENSITIVE_KEY_PARTS)


def redact_value(value: Any) -> str:
    if value is None:
        return "<redacted>"
    text = str(value)
    if len(text) <= 8:
        return "<redacted>"
    return f"{text[:3]}...{text[-3:]} <redacted>"


def redact_obj(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: redact_value(item) if is_sensitive_key(str(key)) else redact_obj(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_obj(item) for item in value]
    return value


def redact_headers(headers: dict[str, str]) -> dict[str, str]:
    return {
        key: redact_value(value) if is_sensitive_key(key) else value
        for key, value in headers.items()
    }


def decode_body_sample(body: bytes, content_type: str | None, max_text_chars: int = 20_000) -> dict[str, Any]:
    content_type = content_type or ""
    result: dict[str, Any] = {
        "size_bytes": len(body),
        "content_type": content_type,
        "truncated": False,
    }

    if not body:
        result["kind"] = "empty"
        return result

    if "application/json" in content_type:
        try:
            result["kind"] = "json"
            result["json"] = redact_obj(json.loads(body.decode("utf-8")))
            return result
        except Exception as exc:
            result["json_error"] = str(exc)

    if content_type.startswith("text/") or "json" in content_type or "xml" in content_type:
        text = body.decode("utf-8", errors="replace")
        result["kind"] = "text"
        if len(text) > max_text_chars:
            result["truncated"] = True
            text = text[:max_text_chars]
        result["text"] = text
        return result

    if "multipart/form-data" in content_type:
        text = body[:max_text_chars].decode("utf-8", errors="replace")
        result["kind"] = "multipart"
        result["truncated"] = len(body) > max_text_chars
        result["preview"] = text
        return result

    result["kind"] = "binary"
    preview = base64.b64encode(body[:2048]).decode("ascii")
    result["base64_preview"] = preview
    result["truncated"] = len(body) > 2048
    return result

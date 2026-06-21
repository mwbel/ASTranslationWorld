#!/usr/bin/env python3
"""Small local HTTP wrapper for open-source Tibetan-to-Chinese translation.

Default model: facebook/nllb-200-distilled-600M

Endpoints:

- GET /health
- POST /translate with JSON field "text"
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


HOST = os.environ.get("NLLB_TRANSLATE_HOST", "127.0.0.1")
PORT = int(os.environ.get("NLLB_TRANSLATE_PORT", "18091"))
MODEL_ID = os.environ.get("NLLB_MODEL", "facebook/nllb-200-distilled-600M")
SRC_LANG = os.environ.get("NLLB_SRC_LANG", "bod_Tibt")
TGT_LANG = os.environ.get("NLLB_TGT_LANG", "zho_Hans")
MAX_INPUT_TOKENS = int(os.environ.get("NLLB_MAX_INPUT_TOKENS", "512"))
MAX_NEW_TOKENS = int(os.environ.get("NLLB_MAX_NEW_TOKENS", "256"))
BATCH_SIZE = int(os.environ.get("NLLB_BATCH_SIZE", "4"))
DEVICE = os.environ.get("NLLB_DEVICE", "auto")

_model_lock = threading.Lock()
_model_bundle: dict[str, Any] | None = None
_model_status: dict[str, Any] = {
    "status": "idle",
    "error": "",
    "started_at": None,
    "ready_at": None,
}
_preload_thread: threading.Thread | None = None


def choose_device(torch_module: Any) -> str:
    if DEVICE != "auto":
        return DEVICE
    if torch_module.cuda.is_available():
        return "cuda"
    if getattr(torch_module.backends, "mps", None) and torch_module.backends.mps.is_available():
        return "mps"
    return "cpu"


def get_model_bundle() -> dict[str, Any]:
    global _model_bundle
    if _model_bundle is not None:
        return _model_bundle

    with _model_lock:
        if _model_bundle is not None:
            return _model_bundle

        _model_status.update({
            "status": "loading",
            "error": "",
            "started_at": _model_status.get("started_at") or time.time(),
            "ready_at": None,
        })

        try:
            import torch
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        except ImportError as exc:
            raise RuntimeError(
                "Missing translation dependencies. Install with: "
                "python3 -m pip install -r bdrc-ocr-compare/requirements-translate.txt"
            ) from exc

        tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, src_lang=SRC_LANG)
        model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID)
        device = choose_device(torch)
        model.to(device)
        model.eval()

        _model_bundle = {
            "torch": torch,
            "tokenizer": tokenizer,
            "model": model,
            "device": device,
        }
        _model_status.update({
            "status": "ready",
            "error": "",
            "ready_at": time.time(),
        })
        return _model_bundle


def preload_model_async() -> None:
    global _preload_thread
    if _model_bundle is not None:
        return
    if _preload_thread and _preload_thread.is_alive():
        return

    def worker() -> None:
        try:
            get_model_bundle()
        except Exception as exc:
            _model_status.update({
                "status": "error",
                "error": str(exc),
                "ready_at": None,
            })
            sys.stderr.write(f"Model preload failed: {exc}\n")

    _model_status.update({
        "status": "loading",
        "error": "",
        "started_at": time.time(),
        "ready_at": None,
    })
    _preload_thread = threading.Thread(target=worker, name="nllb-preload", daemon=True)
    _preload_thread.start()


def model_health_payload() -> dict[str, Any]:
    status = "ready" if _model_bundle is not None else _model_status["status"]
    return {
        "ok": status != "error",
        "status": status,
        "model": MODEL_ID,
        "src_lang": SRC_LANG,
        "tgt_lang": TGT_LANG,
        "loaded": _model_bundle is not None,
        "error": _model_status.get("error") or "",
        "started_at": _model_status.get("started_at"),
        "ready_at": _model_status.get("ready_at"),
    }


def split_text(text: str) -> list[str]:
    lines = [line.strip() for line in text.replace("\r\n", "\n").split("\n")]
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for line in lines:
        if not line:
            if current:
                chunks.append(" ".join(current))
                current = []
                current_len = 0
            continue
        if current and current_len + len(line) > 900:
            chunks.append(" ".join(current))
            current = [line]
            current_len = len(line)
        else:
            current.append(line)
            current_len += len(line)

    if current:
        chunks.append(" ".join(current))

    return chunks or [text.strip()]


def translate_text(text: str) -> dict[str, Any]:
    source_text = text.strip()
    if not source_text:
        return {"translation": "", "chunks": [], "model": MODEL_ID}

    bundle = get_model_bundle()
    torch = bundle["torch"]
    tokenizer = bundle["tokenizer"]
    model = bundle["model"]
    device = bundle["device"]

    tokenizer.src_lang = SRC_LANG
    target_token_id = tokenizer.convert_tokens_to_ids(TGT_LANG)
    if target_token_id is None or target_token_id < 0:
        raise RuntimeError(f"Target language token not found: {TGT_LANG}")

    chunks = split_text(source_text)
    translations: list[str] = []

    with torch.no_grad():
        for index in range(0, len(chunks), BATCH_SIZE):
            batch = chunks[index:index + BATCH_SIZE]
            inputs = tokenizer(
                batch,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=MAX_INPUT_TOKENS,
            )
            inputs = {key: value.to(device) for key, value in inputs.items()}
            generated = model.generate(
                **inputs,
                forced_bos_token_id=target_token_id,
                max_new_tokens=MAX_NEW_TOKENS,
            )
            translations.extend(tokenizer.batch_decode(generated, skip_special_tokens=True))

    translation = "\n".join(item.strip() for item in translations if item.strip())
    return {
        "translation": translation,
        "translated_text": translation,
        "text": translation,
        "chunks": [
            {"source": source, "translation": target}
            for source, target in zip(chunks, translations)
        ],
        "model": MODEL_ID,
        "src_lang": SRC_LANG,
        "tgt_lang": TGT_LANG,
        "device": device,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "NLLBTranslateLocal/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            self.send_json(model_health_payload())
            return

        self.send_json({"error": "Not found"}, status=404)

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/translate":
            self.send_json({"error": "Not found"}, status=404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length)
            payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            text = payload.get("text") or payload.get("source_text") or payload.get("input") or ""
            if not isinstance(text, str):
                raise RuntimeError('JSON field "text" must be a string')
            self.send_json(translate_text(text))
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

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


def main() -> None:
    print(f"NLLB Tibetan-to-Chinese local server: http://{HOST}:{PORT}")
    print(f"model={MODEL_ID} src_lang={SRC_LANG} tgt_lang={TGT_LANG}")
    print("The model downloads and loads in the background after startup.")
    if os.environ.get("NLLB_PRELOAD", "1") not in {"0", "false", "False"}:
        preload_model_async()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()

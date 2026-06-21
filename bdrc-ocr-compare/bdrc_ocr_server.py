#!/usr/bin/env python3
"""Small local HTTP wrapper for the BDRC Tibetan OCR pipeline.

This server is intentionally local-only. It exposes:

- GET /health
- POST /ocr with multipart field "file"

It uses the BDRC Tibetan OCR source checkout and the installed Mac app's bundled
OCR models by default.
"""

from __future__ import annotations

import cgi
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import cv2
import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = PROJECT_ROOT / "tmp" / "tibetan-ocr-app"
DEFAULT_APP_MODELS = Path(
    "/Applications/BDRC Tibetan OCR.app/Contents/MacOS/OCRModels"
)

HOST = os.environ.get("BDRC_OCR_HOST", "127.0.0.1")
PORT = int(os.environ.get("BDRC_OCR_PORT", "18090"))
SOURCE_DIR = Path(os.environ.get("BDRC_SOURCE_DIR", str(DEFAULT_SOURCE_DIR))).resolve()
MODELS_DIR = Path(os.environ.get("BDRC_MODELS_DIR", str(DEFAULT_APP_MODELS))).resolve()
MODEL_NAME = os.environ.get("BDRC_MODEL", "Modern")
LINE_MODE = os.environ.get("BDRC_LINE_MODE", "line")
K_FACTOR = float(os.environ.get("BDRC_K_FACTOR", "2.5"))
BBOX_TOLERANCE = float(os.environ.get("BDRC_BBOX_TOLERANCE", "4.0"))
MERGE_LINES = os.environ.get("BDRC_MERGE_LINES", "1") not in {"0", "false", "False"}
USE_TPS = os.environ.get("BDRC_USE_TPS", "0") in {"1", "true", "True"}
MAX_DESKEW_ANGLE = float(os.environ.get("BDRC_MAX_DESKEW_ANGLE", "8.0"))

_pipeline_lock = threading.Lock()
_pipeline: Any = None
_bdrc_loaded = False


def load_bdrc_modules() -> None:
    global _bdrc_loaded
    if _bdrc_loaded:
        return

    if not SOURCE_DIR.exists():
        raise RuntimeError(
            f"BDRC source directory not found: {SOURCE_DIR}. "
            "Clone it with: git clone https://github.com/buda-base/tibetan-ocr-app.git tmp/tibetan-ocr-app"
        )

    sys.path.insert(0, str(SOURCE_DIR))
    _bdrc_loaded = True


def get_pipeline():
    global _pipeline
    if _pipeline is not None:
        return _pipeline

    load_bdrc_modules()

    from BDRC.Data import LayoutDetectionConfig, LineDetectionConfig
    from BDRC.Inference import OCRPipeline
    from BDRC.Utils import get_platform, import_local_model

    model_dir = MODELS_DIR / MODEL_NAME
    if not model_dir.exists():
        available = ", ".join(sorted(p.name for p in MODELS_DIR.iterdir() if p.is_dir()))
        raise RuntimeError(f"BDRC model not found: {model_dir}. Available models: {available}")

    model = import_local_model(str(model_dir))
    if model is None:
        raise RuntimeError(f"Could not load BDRC model from {model_dir}")

    if LINE_MODE == "layout":
        line_config = LayoutDetectionConfig(
            model_file=str(SOURCE_DIR / "Models" / "Layout" / "photi.onnx"),
            patch_size=512,
            classes=["background", "image", "line", "caption", "margin"],
        )
    else:
        line_config = LineDetectionConfig(
            model_file=str(SOURCE_DIR / "Models" / "Lines" / "PhotiLines.onnx"),
            patch_size=512,
        )

    _pipeline = OCRPipeline(get_platform(), model.config, line_config)
    return _pipeline


def run_ocr(image_bytes: bytes) -> dict[str, Any]:
    load_bdrc_modules()

    import pyewts
    from BDRC.Data import CharsetEncoder, Encoding
    from BDRC.line_detection import (
        build_line_data,
        extract_line_images,
        filter_line_contours,
        get_contours,
        get_rotation_angle_from_lines,
        rotate_from_angle,
        sort_lines_by_threshold2,
    )

    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise RuntimeError("Uploaded file is not a readable image")

    pipeline = get_pipeline()
    with _pipeline_lock:
        # The upstream pipeline auto-deskews from the line mask. On some clean
        # printed pages it can misread Tibetan line contours as a large rotation
        # (for example -35 or -53 degrees), which ruins line extraction. Guard
        # against that and fall back to no rotation for implausible angles.
        if LINE_MODE == "layout":
            layout_mask = pipeline.line_inference.predict(image)
            line_mask = layout_mask[:, :, 2]
        else:
            line_mask = pipeline.line_inference.predict(image)

        raw_angle = get_rotation_angle_from_lines(line_mask)
        if abs(raw_angle) <= MAX_DESKEW_ANGLE:
            used_angle = raw_angle
            rot_img = rotate_from_angle(image, raw_angle)
            rot_mask = rotate_from_angle(line_mask, raw_angle)
            angle_guarded = False
        else:
            used_angle = 0.0
            rot_img = image
            rot_mask = line_mask
            angle_guarded = True

        line_contours = get_contours(rot_mask)
        line_contours = [cnt for cnt in line_contours if cv2.contourArea(cnt) > 10]
        if len(rot_mask.shape) == 2:
            rgb_mask = cv2.cvtColor(rot_mask, cv2.COLOR_GRAY2RGB)
        else:
            rgb_mask = rot_mask

        filtered_contours = filter_line_contours(rgb_mask, line_contours)
        if not filtered_contours:
            raise RuntimeError("No valid lines after filtering")

        line_data = [build_line_data(cnt) for cnt in filtered_contours]
        sorted_lines, line_threshold = sort_lines_by_threshold2(
            rgb_mask, line_data, group_lines=MERGE_LINES
        )
        line_images = extract_line_images(
            rot_img,
            sorted_lines,
            default_k=K_FACTOR,
            bbox_tolerance=BBOX_TOLERANCE,
        )

        converter = pyewts.pyewts()
        line_texts = []
        for line_img in line_images:
            pred = pipeline.ocr_inference.run(line_img).strip().replace("§", " ")
            if pipeline.encoder == CharsetEncoder.Wylie:
                pred = converter.toUnicode(pred)
            line_texts.append(pred)

    return {
        "text": "\n".join(line_texts),
        "lines": [{"text": text} for text in line_texts],
        "line_count": len(line_texts),
        "detected_line_count": len(sorted_lines),
        "raw_angle": raw_angle,
        "angle": used_angle,
        "angle_guarded": angle_guarded,
        "line_threshold": line_threshold,
        "model": MODEL_NAME,
        "line_mode": LINE_MODE,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "BDRCOCRLocal/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            try:
                load_bdrc_modules()
                payload = {
                    "ok": True,
                    "model": MODEL_NAME,
                    "line_mode": LINE_MODE,
                    "source_dir": str(SOURCE_DIR),
                    "models_dir": str(MODELS_DIR),
                }
                self.send_json(payload)
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, status=500)
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

            payload = run_ocr(image_bytes)
            self.send_json(payload)
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
    print(f"BDRC OCR local server: http://{HOST}:{PORT}")
    print(f"source_dir={SOURCE_DIR}")
    print(f"models_dir={MODELS_DIR}")
    print(f"model={MODEL_NAME} line_mode={LINE_MODE}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()

from __future__ import annotations

from typing import Any


def call_ai_ocr(image: bytes, filename: str, draft: str = "", prompt: str = "") -> dict[str, Any]:
    from importlib.util import module_from_spec, spec_from_file_location
    from pathlib import Path

    path = Path(__file__).parent / "tibetan-ocr-core" / "ai_vision_ocr_server.py"
    spec = spec_from_file_location("ai_vision_ocr_server", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载 AI Vision OCR 服务")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.call_vision_model(image, filename, prompt or module.default_prompt(draft))

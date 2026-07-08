# tibetan-ocr-core

This repository hosts the standalone Tibetan OCR service layer.

## Scope

- Wrap the local BDRC OCR runtime behind an HTTP API.
- Accept rendered page images from upper-layer apps.
- Return OCR text and line-level bounding boxes.

## Run

From the workspace root:

```bash
python3 tibetan-ocr-core/bdrc_ocr_server.py
```

AI Vision OCR adapter:

```bash
python3 tibetan-ocr-core/ai_vision_ocr_server.py
```

By default the AI Vision adapter calls the local ModelAggregatorService:

```bash
AI_VISION_PROVIDER=model_aggregator \
MODEL_AGGREGATOR_BASE_URL=http://127.0.0.1:8890 \
AI_VISION_MODEL=gemini:gemini-2.5-flash \
python3 tibetan-ocr-core/ai_vision_ocr_server.py
```

To use a direct OpenAI-compatible vision endpoint instead:

```bash
AI_VISION_PROVIDER=openai-compatible \
AI_VISION_BASE_URL=http://127.0.0.1:11434/v1 \
AI_VISION_MODEL=qwen2.5-vl:7b \
python3 tibetan-ocr-core/ai_vision_ocr_server.py
```

Health check:

```bash
curl http://127.0.0.1:18090/health
curl http://127.0.0.1:18092/health
```

## Runtime requirements

- BDRC source checkout: `tmp/tibetan-ocr-app`
- macOS model directory:

```text
/Applications/BDRC Tibetan OCR.app/Contents/MacOS/OCRModels
```

## Notes

- Default model: `Modern`
- Default line mode: `line`
- AI Vision OCR endpoint: `POST http://127.0.0.1:18092/ocr`
- AI Vision OCR defaults to ModelAggregatorService `/api/aggregate/image-to-markdown`.
- OpenAI-compatible `/chat/completions` mode remains available through `AI_VISION_PROVIDER=openai-compatible`.
- This repo is intended to be publishable without translation or frontend code.

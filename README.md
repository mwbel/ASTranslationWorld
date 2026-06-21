# ASTranslationWorld

This workspace contains tooling around AS Yilin model routing and Tibetan OCR comparison workflows.

## Modules

- `bdrc-ocr-compare/`: browser-based Tibetan source/OCR comparison workbench.
  - Upload or load PDF files.
  - Render PDF pages side by side with OCR text.
  - Call a local BDRC OCR wrapper service at `http://127.0.0.1:18090/ocr`.
- `as-yilin-model-adapter/`: model gateway/probe services for AS Yilin BYO key integration.
- `sutra-image-package-20260611-2159-server-runtime-amd64/`: local deployment notes and compose files for the AS Yilin runtime package. Binary runtime assets and images are intentionally excluded from git.

## Run the OCR comparison page

Start the static frontend from the repository root:

```bash
python3 -m http.server 8790 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:8790/bdrc-ocr-compare/
```

Start the local BDRC OCR wrapper:

```bash
python3 bdrc-ocr-compare/bdrc_ocr_server.py
```

Health check:

```bash
curl http://127.0.0.1:18090/health
```

The wrapper expects the BDRC source checkout under `tmp/tibetan-ocr-app` and the installed macOS client models under:

```text
/Applications/BDRC Tibetan OCR.app/Contents/MacOS/OCRModels
```

`tmp/` is intentionally ignored by git. Recreate it with:

```bash
git clone https://github.com/buda-base/tibetan-ocr-app.git tmp/tibetan-ocr-app
```

## Repository hygiene

Large local PDFs, DOCX files, screenshots, runtime logs, Docker image archives, `.env`, and runtime `config.yaml` files are excluded from git. Use the example config files as templates.

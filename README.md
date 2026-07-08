# ASTranslationWorld

This workspace contains AS Yilin routing work plus a Tibetan OCR and translation toolchain that is now split by repository boundary.

## Modules

- `tibetan-ocr-core/`
  - Standalone Tibetan OCR service layer.
  - Provides the local BDRC HTTP wrapper and OCR-specific docs.
- `tibetan-translation-services/`
  - Translation service layer.
  - Hosts Tibetan-to-Chinese now, with room for Chinese-to-English and future model backends.
- `tibetan-proofreading-app/`
  - Browser workbench for PDF comparison, OCR review, translation review, and export.
  - Depends on the OCR and translation service repos through HTTP endpoints.
- `as-yilin-model-adapter/`
  - Model gateway/probe services for AS Yilin BYO key integration.
- `sutra-image-package-20260611-2159-server-runtime-amd64/`
  - Local deployment notes and compose files for the AS Yilin runtime package.

## Split direction

The Tibetan stack is organized so it can be published as three independent GitHub repositories:

- `tibetan-ocr-core`
- `tibetan-translation-services`
- `tibetan-proofreading-app`

At the moment they still live in one workspace so local integration remains simple.

## Local run

From the workspace root:

```bash
./tibetan-proofreading-app/start_services.sh
```

Frontend:

```text
http://127.0.0.1:8790/tibetan-proofreading-app/
```

## Repository hygiene

Large local PDFs, DOCX files, screenshots, runtime logs, Docker image archives, `.env`, and runtime `config.yaml` files are excluded from git. Use the example config files as templates.

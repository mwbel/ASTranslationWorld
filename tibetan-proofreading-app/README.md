# tibetan-proofreading-app

This repository is the user-facing proofreading workbench.

## Scope

- Upload PDF or image files.
- Render source pages.
- Call `tibetan-ocr-core` for OCR.
- Call `tibetan-translation-services` for translation.
- Support page-by-page review, manual correction, and export.

## Local run

From the workspace root:

```bash
./tibetan-proofreading-app/start_services.sh
```

Frontend URL:

```text
http://127.0.0.1:8790/tibetan-proofreading-app/
```

## Architecture boundary

- This repo does not own OCR model execution.
- This repo does not own translation model execution.
- It is the orchestration and proofreading UI layer only.

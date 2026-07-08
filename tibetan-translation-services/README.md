# tibetan-translation-services

This repository hosts translation backends as independent services.

## Current service

- Tibetan to Chinese via `nllb_translate_server.py`

## Planned service families

- `bo-zh`
- `zh-en`
- future multi-hop or model-switched translation backends

## Install

```bash
python3 -m pip install -r tibetan-translation-services/requirements-translate.txt
```

## Run

```bash
python3 tibetan-translation-services/nllb_translate_server.py
```

Health check:

```bash
curl http://127.0.0.1:18091/health
```

## Notes

- Default model: `facebook/nllb-200-distilled-600M`
- Current default direction: `bod_Tibt -> zho_Hans`
- This repo is intended to evolve separately from OCR and the workbench UI.

# TB Paragraph Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local paragraph translation page for numbered Tibetan TXT, with stable IDs, two model results, human final text, batch pilot, resume, and export.

**Architecture:** A standalone HTML page consumes a pure core module for parsing, paging, request construction and export. A browser controller handles the existing translation endpoint and IndexedDB persistence keyed by document hash and paragraph ID. Existing OCR workbench files remain untouched.

**Tech Stack:** Browser JavaScript, IndexedDB, Node built-in test runner, existing Python translation service.

**Spec:** `docs/superpowers/specs/2026-11-01-tb-paragraph-translation-design.md`

## Global Constraints

- Do not alter the supplied TXT, OCR backend, existing workbench caches, or uncommitted user edits.
- One TB ID is one translation unit; 15 units per virtual page.
- Store each model result by exact model ID; store the human final separately.

## Review Focus

- Blank and malformed lines: reject import with a clear error.
- Duplicate TB IDs: reject import before saving.
- Different source text under the same filename: use a different document hash.
- Model failure mid-batch: preserve earlier translations and report the failed ID.
- Page navigation during edits: save the human final before changing selection.

---

### Task 1: Pure paragraph contracts

**Files:** Create `tibetan-proofreading-app/tb-translation-core.js`; test `tibetan-proofreading-app/tests/tb-translation-core.test.cjs`.

**Interfaces:** `parseTbDocument(text)`, `getVirtualPage(rows, page, size)`, `buildTranslationRequest(row, neighbors, options)`, `extractTranslation(payload)`, `exportTranslationMarkdown(rows, records, models)`.

- [x] Write parsing, paging, request, response, export tests; run and see missing-function failures.
- [x] Implement the pure module and verify its tests pass.

### Task 2: Browser translation page

**Files:** Create `tibetan-proofreading-app/tb-translation.html`, `tb-translation.css`, `tb-translation.js`; test `tibetan-proofreading-app/tests/tb-translation-core.test.cjs` for a real batch runner function exported from the core.

**Interfaces:** `runTranslationBatch(rows, modelIds, existing, translate, onResult, signal)` saves each completed pair independently and stops on failure or abort.

- [x] Add failing batch tests, then implement and verify.
- [x] Add import, model controls, page navigation, per-model translate, 20-segment pilot, local persistence, final editor and export UI.
- [x] Run syntax checks and the relevant test suite.

### Task 3: Documentation and manual verification

**Files:** Append `提示词历史.md`; create one `任务重点整理/` note.

- [x] Check the page and `/health` locally; perform browser smoke checks where service availability permits.
- [x] Run `git diff --check`, `git status`, and inspect exact files before a selective commit/push.

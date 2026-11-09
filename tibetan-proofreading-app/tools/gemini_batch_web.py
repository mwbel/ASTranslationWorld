#!/usr/bin/env python3
"""Local-only browser interface for the Gemini Batch OCR command-line helper."""

from __future__ import annotations

import argparse
import base64
import binascii
import importlib.util
import json
import os
import re
import shutil
import tempfile
import threading
import uuid
from datetime import datetime, timezone
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from gemini_batch_ocr import (
    BatchToolError,
    DEFAULT_MODEL,
    check_status,
    download_results,
    parse_result_jsonl,
    prepare_jsonl,
    render_text_results,
    submit_batch,
)


APP_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = Path.home() / "Library" / "Application Support" / "TibetanGeminiBatch"
EXISTING_KEY_POOL = APP_DIR.parent.parent / "ModelAggregatorService" / ".env"
MAX_BODY_BYTES = 22 * 1024**2
MAX_PAGE_BYTES = 14 * 1024**2
MAX_ACTIVE_BATCHES = 8
POLL_SECONDS = 30
TOKEN_FIELDS = {
    "prompt": ("promptTokenCount", "prompt_token_count"),
    "candidates": ("candidatesTokenCount", "candidates_token_count", "responseTokenCount", "response_token_count"),
    "thoughts": ("thoughtsTokenCount", "thoughts_token_count"),
    "total": ("totalTokenCount", "total_token_count"),
}
JOB_ID_PATTERN = re.compile(r"[0-9a-f]{32}\Z")
STATIC_FILES = {
    "/gemini-batch.html": (APP_DIR / "gemini-batch.html", "text/html; charset=utf-8"),
    "/gemini-batch.js": (APP_DIR / "gemini-batch.js", "text/javascript; charset=utf-8"),
    "/vendor/pdf.min.js": (APP_DIR / "vendor/pdf.min.js", "text/javascript; charset=utf-8"),
    "/vendor/pdf.worker.min.js": (APP_DIR / "vendor/pdf.worker.min.js", "text/javascript; charset=utf-8"),
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _sdk_available() -> bool:
    try:
        return importlib.util.find_spec("google.genai") is not None
    except ModuleNotFoundError:
        return False


def configure_api_key(key_pool_file: Path = EXISTING_KEY_POOL) -> str:
    """Reuse the first local comparison key without returning or logging its value."""
    if os.environ.get("GEMINI_API_KEY", "").strip():
        return "GEMINI_API_KEY 环境变量"
    pool = os.environ.get("GEMINI_API_KEYS", "").strip()
    source = "GEMINI_API_KEYS 环境变量"
    if not pool and key_pool_file.is_file():
        for line in key_pool_file.read_text(encoding="utf-8").splitlines():
            if line.lstrip().startswith("GEMINI_API_KEYS="):
                pool = line.split("=", 1)[1].strip()
                source = "现有本地密钥池文件"
                break
    first_key = pool.strip().strip('"').strip("'").split(",", 1)[0].strip()
    if not first_key:
        return "未配置"
    os.environ["GEMINI_API_KEY"] = first_key
    return f"{source}（第 1 个 key）"


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            temporary = stream.name
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary:
            Path(temporary).unlink(missing_ok=True)


def _atomic_bytes(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: str | None = None
    try:
        with tempfile.NamedTemporaryFile("wb", dir=path.parent, delete=False) as stream:
            temporary = stream.name
            stream.write(value)
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary:
            Path(temporary).unlink(missing_ok=True)


def _token_usage_from_output(path: Path) -> dict[str, int | None] | None:
    """Read reported token usage from one Batch result file, without estimating missing values."""
    if not path.is_file():
        return None
    values: dict[str, int | None] = {name: None for name in TOKEN_FIELDS}
    try:
        lines = path.read_text(encoding="utf-8-sig").splitlines()
        for raw_line in lines:
            if not raw_line.strip():
                continue
            row = json.loads(raw_line)
            if not isinstance(row, dict):
                continue
            response = row.get("response")
            if not isinstance(response, dict):
                continue
            metadata = response.get("usageMetadata") or response.get("usage_metadata")
            if not isinstance(metadata, dict):
                continue
            for name, aliases in TOKEN_FIELDS.items():
                raw = next((metadata[key] for key in aliases if key in metadata), None)
                if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0:
                    values[name] = (values[name] or 0) + raw
    except (OSError, UnicodeError, ValueError):
        return None
    return values if any(value is not None for value in values.values()) else None


def _sum_token_usage(usages: list[dict[str, int | None]]) -> dict[str, int | None]:
    return {
        name: sum(value for usage in usages if (value := usage.get(name)) is not None)
        if any(usage.get(name) is not None for usage in usages) else None
        for name in TOKEN_FIELDS
    }


class LocalBatchStore:
    def __init__(self, data_dir: Path, *, key_source: str = "未配置"):
        self.data_dir = data_dir.expanduser().resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._wake = threading.Event()
        self._worker: threading.Thread | None = None
        self.key_source = key_source

    def _job_dir(self, job_id: str) -> Path:
        if not JOB_ID_PATTERN.fullmatch(job_id):
            raise BatchToolError("无效的任务编号。")
        directory = self.data_dir / job_id
        if not (directory / "meta.json").is_file():
            raise BatchToolError("找不到该本地任务。")
        return directory

    def _meta(self, job_id: str) -> dict[str, Any]:
        return json.loads((self._job_dir(job_id) / "meta.json").read_text(encoding="utf-8"))

    def _workflow(self, directory: Path) -> dict[str, Any]:
        return json.loads((directory / "workflow.json").read_text(encoding="utf-8"))

    def _write_workflow(self, directory: Path, workflow: dict[str, Any]) -> None:
        _atomic_json(directory / "workflow.json", workflow)

    def _page_dir(self, directory: Path, page: int) -> Path:
        return directory / "batch_pages" / f"page-{page:04d}"

    def _attempt_dir(self, directory: Path, page: int, attempt: int) -> Path:
        return self._page_dir(directory, page) / f"attempt-{attempt:04d}"

    def _attempt_usage(self, attempt_dir: Path) -> dict[str, int | None] | None:
        usage_path = attempt_dir / "usage.json"
        if usage_path.is_file():
            try:
                return json.loads(usage_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
        return _token_usage_from_output(attempt_dir / "output.jsonl")

    def _checkpoint_summary(self, directory: Path, workflow: dict[str, Any]) -> dict[str, Any]:
        pages = []
        all_usages: list[dict[str, int | None]] = []
        for page_text, entry in sorted(workflow["pages"].items(), key=lambda item: int(item[0])):
            page = int(page_text)
            cached = (directory / "cache" / f"page-{page:04d}.json").is_file()
            page_usages = [usage for attempt_dir in sorted(self._page_dir(directory, page).glob("attempt-*"))
                           if (usage := self._attempt_usage(attempt_dir)) is not None]
            all_usages.extend(page_usages)
            pages.append({
                "page": page,
                "status": "saved" if cached else entry["status"],
                "attempt": entry.get("attempt", 0),
                "error": entry.get("error"),
                "usage": _sum_token_usage(page_usages),
                "usage_attempts": len(page_usages),
            })
        return {
            "submitted_at": workflow.get("submitted_at"),
            "total": len(pages),
            "saved": sum(item["status"] == "saved" for item in pages),
            "active": sum(item["status"] in {"creating", "submitted", "running"} for item in pages),
            "failed": sum(item["status"] == "failed" for item in pages),
            "review": sum(item["status"] == "review" for item in pages),
            "usage": _sum_token_usage(all_usages),
            "usage_attempts": len(all_usages),
            "pages": pages,
        }

    def describe(self, job_id: str) -> dict[str, Any]:
        directory = self._job_dir(job_id)
        meta = self._meta(job_id)
        meta["uploaded_pages"] = len(list((directory / "pages").glob("page-*.jpg")))
        meta["prepared"] = (directory / "input.jsonl").is_file()
        meta["has_result_jsonl"] = (directory / "output.jsonl").is_file()
        meta["has_result_txt"] = (directory / "output.txt").is_file()
        state_path = directory / "state.json"
        meta["batch"] = json.loads(state_path.read_text(encoding="utf-8")) if state_path.is_file() else None
        workflow_path = directory / "workflow.json"
        meta["checkpoint"] = self._checkpoint_summary(directory, self._workflow(directory)) if workflow_path.is_file() else None
        if meta["checkpoint"] is None:
            legacy_usage = _token_usage_from_output(directory / "output.jsonl")
            meta["usage"] = legacy_usage or _sum_token_usage([])
        return meta

    def list_jobs(self) -> list[dict[str, Any]]:
        jobs = []
        for path in self.data_dir.iterdir():
            if path.is_dir() and JOB_ID_PATTERN.fullmatch(path.name) and (path / "meta.json").is_file():
                try:
                    jobs.append(self.describe(path.name))
                except (OSError, ValueError):
                    continue
        return sorted(jobs, key=lambda item: item["created_at"], reverse=True)

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        title = str(payload.get("title", "")).strip()[:120]
        prompt = str(payload.get("prompt", "")).strip()
        model = str(payload.get("model", DEFAULT_MODEL)).strip()
        try:
            expected_pages = int(payload.get("expected_pages", 0))
        except (TypeError, ValueError) as exc:
            raise BatchToolError("页数必须是整数。") from exc
        if not title or not prompt or not model:
            raise BatchToolError("请填写任务名称、提示词和模型名称。")
        if len(prompt) > 30000:
            raise BatchToolError("提示词过长；最多 30000 字符。")
        if not 1 <= expected_pages <= 2000:
            raise BatchToolError("页数必须在 1 到 2000 之间。")
        job_id = uuid.uuid4().hex
        directory = self.data_dir / job_id
        directory.mkdir()
        (directory / "pages").mkdir()
        meta = {
            "id": job_id,
            "title": title,
            "prompt": prompt,
            "model": model,
            "expected_pages": expected_pages,
            "created_at": _now(),
        }
        _atomic_json(directory / "meta.json", meta)
        return self.describe(job_id)

    def add_page(self, job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            directory = self._job_dir(job_id)
            meta = self._meta(job_id)
            if (directory / "input.jsonl").exists():
                raise BatchToolError("请求已打包，不能再修改页图；请创建新任务。")
            try:
                page = int(payload.get("page", 0))
            except (TypeError, ValueError) as exc:
                raise BatchToolError("页码必须是整数。") from exc
            if not 1 <= page <= meta["expected_pages"]:
                raise BatchToolError("页码超出本任务范围。")
            if payload.get("mime_type") != "image/jpeg":
                raise BatchToolError("页图必须是 JPEG；页面会在本地浏览器转换。")
            encoded = payload.get("data")
            if not isinstance(encoded, str):
                raise BatchToolError("页图数据缺失。")
            try:
                content = base64.b64decode(encoded, validate=True)
            except binascii.Error as exc:
                raise BatchToolError("页图不是有效的 Base64 数据。") from exc
            if not content.startswith(b"\xff\xd8\xff") or not content.endswith(b"\xff\xd9"):
                raise BatchToolError("页图不是完整的 JPEG 文件。")
            if len(content) > MAX_PAGE_BYTES:
                raise BatchToolError("单页超过 14 MiB，请缩小图片后重试。")
            target = directory / "pages" / f"page-{page:04d}.jpg"
            target.write_bytes(content)
            return {"page": page, "uploaded_pages": len(list((directory / "pages").glob("page-*.jpg")))}

    def prepare(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            directory = self._job_dir(job_id)
            meta = self._meta(job_id)
            if (directory / "state.json").exists():
                raise BatchToolError("任务已提交，不能重新打包。")
            if (directory / "workflow.json").is_file() and self._workflow(directory).get("submitted_at"):
                raise BatchToolError("任务已提交，不能重新打包。")
            pages = directory / "pages"
            missing = [page for page in range(1, meta["expected_pages"] + 1) if not (pages / f"page-{page:04d}.jpg").is_file()]
            if missing:
                raise BatchToolError(f"尚缺少 {len(missing)} 页，第一处是第 {missing[0]} 页。")
            prompt_path = directory / "prompt.txt"
            prompt_path.write_text(meta["prompt"], encoding="utf-8")
            count = prepare_jsonl(images_dir=pages, prompt_file=prompt_path, output=directory / "input.jsonl", overwrite=True)
            workflow = {"version": 2, "submitted_at": None, "pages": {}}
            with (directory / "input.jsonl").open("r", encoding="utf-8") as stream:
                for page, line in enumerate(stream, start=1):
                    page_dir = self._page_dir(directory, page)
                    _atomic_bytes(page_dir / "input.jsonl", line.encode("utf-8"))
                    workflow["pages"][str(page)] = {"status": "ready", "attempt": 0, "error": None}
            self._write_workflow(directory, workflow)
            meta["prepared_at"] = _now()
            _atomic_json(directory / "meta.json", meta)
            return {"count": count, "input_bytes": (directory / "input.jsonl").stat().st_size, "job": self.describe(job_id)}

    def submit(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            directory = self._job_dir(job_id)
            meta = self._meta(job_id)
            if not (directory / "input.jsonl").is_file():
                raise BatchToolError("请先生成 JSONL。")
            if (directory / "workflow.json").is_file():
                workflow = self._workflow(directory)
                if workflow.get("submitted_at"):
                    raise BatchToolError("任务已经提交；请查看逐页状态。")
                workflow["submitted_at"] = _now()
                self._write_workflow(directory, workflow)
                self._wake.set()
                return self.describe(job_id)
            if (directory / "state.json").exists():
                raise BatchToolError("任务已经提交；请刷新状态。")
            submit_batch(directory / "input.jsonl", directory / "state.json", model=meta["model"], display_name=meta["title"])
            return self.describe(job_id)

    def refresh(self, job_id: str) -> dict[str, Any]:
        directory = self._job_dir(job_id)
        if (directory / "workflow.json").is_file():
            self._wake.set()
            return self.describe(job_id)
        check_status(directory / "state.json")
        return self.describe(job_id)

    def fetch(self, job_id: str) -> dict[str, Any]:
        directory = self._job_dir(job_id)
        if (directory / "workflow.json").is_file():
            self._rebuild_exports(directory)
            summary = self._checkpoint_summary(directory, self._workflow(directory))
            return {"count": summary["saved"], "errors": summary["failed"], "job": self.describe(job_id)}
        rows = download_results(directory / "state.json", output_jsonl=directory / "output.jsonl", output_text=directory / "output.txt")
        return {"count": len(rows), "errors": sum(bool(row.get("error")) for row in rows), "job": self.describe(job_id)}

    def retry_failed(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            directory = self._job_dir(job_id)
            if not (directory / "workflow.json").is_file():
                raise BatchToolError("该任务不支持逐页重试。")
            workflow = self._workflow(directory)
            if not workflow.get("submitted_at"):
                raise BatchToolError("任务尚未提交。")
            retried = 0
            for page_text, entry in workflow["pages"].items():
                if entry["status"] == "failed" and not (directory / "cache" / f"page-{int(page_text):04d}.json").exists():
                    entry["status"] = "ready"
                    entry["error"] = None
                    retried += 1
            if not retried:
                raise BatchToolError("没有可安全重试的失败页；提交结果不明的页需先到 Google 核对。")
            self._write_workflow(directory, workflow)
            self._wake.set()
            return {"retried": retried, "job": self.describe(job_id)}

    def _update_page(self, directory: Path, page: int, **values: Any) -> None:
        with self._lock:
            workflow = self._workflow(directory)
            workflow["pages"][str(page)].update(values)
            self._write_workflow(directory, workflow)

    def _rebuild_exports(self, directory: Path) -> None:
        with self._lock:
            workflow = self._workflow(directory)
            text_rows: list[dict[str, str | None]] = []
            raw_rows: list[bytes] = []
            for page_text in sorted(workflow["pages"], key=int):
                page = int(page_text)
                cache_path = directory / "cache" / f"page-{page:04d}.json"
                if not cache_path.is_file():
                    continue
                cache = json.loads(cache_path.read_text(encoding="utf-8"))
                text_rows.append({"key": f"page-{page:04d}", "text": cache["text"], "error": None})
                raw_path = self._attempt_dir(directory, page, cache["attempt"]) / "output.jsonl"
                if raw_path.is_file():
                    raw_rows.append(raw_path.read_bytes().strip() + b"\n")
            if text_rows:
                _atomic_bytes(directory / "output.txt", render_text_results(text_rows).encode("utf-8"))
                _atomic_bytes(directory / "output.jsonl", b"".join(raw_rows))

    def _submit_page(self, directory: Path, page: int) -> bool:
        with self._lock:
            workflow = self._workflow(directory)
            entry = workflow["pages"][str(page)]
            if entry["status"] != "ready":
                return True
            attempt = int(entry.get("attempt", 0)) + 1
            entry.update({"status": "creating", "attempt": attempt, "error": None, "last_changed_at": _now()})
            self._write_workflow(directory, workflow)
        attempt_dir = self._attempt_dir(directory, page, attempt)
        attempt_dir.mkdir(parents=True, exist_ok=True)
        state_path = attempt_dir / "state.json"
        try:
            meta = json.loads((directory / "meta.json").read_text(encoding="utf-8"))
            state = submit_batch(
                self._page_dir(directory, page) / "input.jsonl",
                state_path,
                model=meta["model"],
                display_name=f"{meta['title']} 第 {page} 页",
            )
        except Exception as exc:
            detail_path = state_path.with_name("submission-error.json")
            detail = json.loads(detail_path.read_text(encoding="utf-8")) if detail_path.is_file() else None
            if state_path.is_file():
                self._update_page(directory, page, status="submitted", error=str(exc))
            else:
                self._update_page(
                    directory, page, status="review",
                    error=(f"{detail['stage']} 失败（HTTP {detail['http_code']}）：{detail['message']}"
                           if detail else f"提交结果不明（{type(exc).__name__}）。请先在 Google 核对，再决定是否重试。"),
                )
            return False
        self._update_page(directory, page, status="submitted", job_name=state["job_name"], error=None)
        return True

    def _poll_page(self, directory: Path, page: int, attempt: int) -> None:
        attempt_dir = self._attempt_dir(directory, page, attempt)
        state_path = attempt_dir / "state.json"
        try:
            state = check_status(state_path)
            status = state["state"]
            if status == "JOB_STATE_SUCCEEDED":
                raw_path = attempt_dir / "output.jsonl"
                if raw_path.is_file():
                    try:
                        rows = parse_result_jsonl(raw_path.read_bytes())
                    except (BatchToolError, UnicodeError):
                        # A process may have stopped while writing this generated file.
                        rows = download_results(
                            state_path, output_jsonl=attempt_dir / "output-recovered.jsonl",
                            output_text=attempt_dir / "output.txt",
                        )
                        os.replace(attempt_dir / "output-recovered.jsonl", raw_path)
                else:
                    rows = download_results(
                        state_path, output_jsonl=attempt_dir / "output-downloading.jsonl",
                        output_text=attempt_dir / "output.txt",
                    )
                    os.replace(attempt_dir / "output-downloading.jsonl", raw_path)
                usage = _token_usage_from_output(raw_path)
                if usage:
                    _atomic_json(attempt_dir / "usage.json", usage)
                expected_key = f"page-{page:04d}"
                if len(rows) != 1 or rows[0]["key"] != expected_key:
                    self._update_page(directory, page, status="failed", error="返回结果与当前页不对应。")
                    return
                row = rows[0]
                if row.get("error") or not row.get("text"):
                    self._update_page(directory, page, status="failed", error=str(row.get("error") or "响应没有可用文字。"))
                    return
                _atomic_json(directory / "cache" / f"page-{page:04d}.json", {
                    "page": page, "text": row["text"], "attempt": attempt,
                    "job_name": state["job_name"], "saved_at": _now(),
                })
                self._rebuild_exports(directory)
                self._update_page(directory, page, status="saved", error=None)
            elif status in {"JOB_STATE_FAILED", "JOB_STATE_CANCELLED", "JOB_STATE_EXPIRED"}:
                self._update_page(directory, page, status="failed", error=str(state.get("error") or status))
            else:
                self._update_page(directory, page, status="running", error=None)
        except Exception as exc:
            self._update_page(directory, page, error=f"状态检查暂不可用（{type(exc).__name__}）；稍后自动重试。")

    def _pending_job_dirs(self) -> list[Path]:
        directories = []
        for path in self.data_dir.iterdir():
            if path.is_dir() and (path / "workflow.json").is_file():
                try:
                    if self._workflow(path).get("submitted_at"):
                        directories.append(path)
                except (OSError, ValueError):
                    continue
        return sorted(directories, key=lambda path: path.name)

    def process_once(self) -> None:
        """Advance all submitted jobs once; safe to call after a server restart."""
        directories = self._pending_job_dirs()
        for directory in directories:
            workflow = self._workflow(directory)
            for page_text, entry in sorted(workflow["pages"].items(), key=lambda item: int(item[0])):
                page = int(page_text)
                if (directory / "cache" / f"page-{page:04d}.json").is_file():
                    if entry["status"] != "saved":
                        self._rebuild_exports(directory)
                        self._update_page(directory, page, status="saved", error=None)
                    continue
                if entry["status"] == "creating":
                    state_path = self._attempt_dir(directory, page, int(entry["attempt"])) / "state.json"
                    if state_path.is_file():
                        self._update_page(directory, page, status="submitted", error=None)
                    else:
                        self._update_page(directory, page, status="review", error="服务中断时提交结果不明；请先在 Google 核对。")
                elif entry["status"] in {"submitted", "running"}:
                    self._poll_page(directory, page, int(entry["attempt"]))

        active = sum(
            self._checkpoint_summary(directory, self._workflow(directory))["active"]
            for directory in directories
        )
        for directory in directories:
            if active >= MAX_ACTIVE_BATCHES:
                break
            workflow = self._workflow(directory)
            for page_text, entry in sorted(workflow["pages"].items(), key=lambda item: int(item[0])):
                if active >= MAX_ACTIVE_BATCHES:
                    break
                if entry["status"] != "ready":
                    continue
                if not self._submit_page(directory, int(page_text)):
                    break
                active += 1

    def start_background(self) -> None:
        if self._worker and self._worker.is_alive():
            return

        def run() -> None:
            while True:
                try:
                    self.process_once()
                except Exception as exc:
                    print(f"Gemini Batch 后台检查失败：{type(exc).__name__}", flush=True)
                self._wake.wait(POLL_SECONDS)
                self._wake.clear()

        self._worker = threading.Thread(target=run, name="gemini-batch-checkpoints", daemon=True)
        self._worker.start()

    def download_path(self, job_id: str, kind: str) -> Path:
        directory = self._job_dir(job_id)
        filenames = {"input": "input.jsonl", "jsonl": "output.jsonl", "txt": "output.txt"}
        if kind not in filenames:
            raise BatchToolError("未知的下载类型。")
        path = directory / filenames[kind]
        if not path.is_file():
            raise BatchToolError("该文件尚未生成。")
        return path


class BatchPageHandler(BaseHTTPRequestHandler):
    server_version = "GeminiBatchLocal/1.0"

    def __init__(self, *args: Any, store: LocalBatchStore, **kwargs: Any):
        self.store = store
        super().__init__(*args, **kwargs)

    def _send(self, status: int, body: bytes, content_type: str, *, filename: str | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(body)

    def _json(self, payload: dict[str, Any] | list[Any], status: int = 200) -> None:
        self._send(status, json.dumps(payload, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _send_file(self, path: Path, content_type: str, filename: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(path.stat().st_size))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        with path.open("rb") as stream:
            shutil.copyfileobj(stream, self.wfile, length=1024 * 1024)

    def _error(self, error: Exception, status: int = 400) -> None:
        message = str(error)
        secret = os.environ.get("GEMINI_API_KEY", "")
        if secret:
            message = message.replace(secret, "[已隐藏的 API key]")
        self._json({"error": message}, status)

    def _allowed_host(self) -> bool:
        host = self.headers.get("Host", "").split(":", 1)[0]
        return host in {"127.0.0.1", "localhost"}

    def _parts(self) -> list[str]:
        return [part for part in urlsplit(self.path).path.split("/") if part]

    def do_HEAD(self) -> None:
        if not self._allowed_host():
            self.send_response(403)
            self.end_headers()
            return
        path = urlsplit(self.path).path
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/gemini-batch.html")
        elif path in STATIC_FILES and STATIC_FILES[path][0].is_file():
            static_path, content_type = STATIC_FILES[path]
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(static_path.stat().st_size))
            self.send_header("Cache-Control", "no-store")
        elif path == "/api/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
        else:
            self.send_response(404)
        self.end_headers()

    def do_GET(self) -> None:
        if not self._allowed_host():
            self._error(BatchToolError("仅允许通过本机地址访问。"), 403)
            return
        path = urlsplit(self.path).path
        if path == "/":
            self.send_response(302)
            self.send_header("Location", "/gemini-batch.html")
            self.end_headers()
            return
        if path in STATIC_FILES:
            static_path, content_type = STATIC_FILES[path]
            try:
                self._send(200, static_path.read_bytes(), content_type)
            except OSError as exc:
                self._error(exc, 500)
            return
        parts = self._parts()
        try:
            if parts == ["api", "health"]:
                self._json({"ok": True, "api_key_ready": bool(os.environ.get("GEMINI_API_KEY")), "key_source": self.store.key_source, "sdk_ready": _sdk_available()})
            elif parts == ["api", "jobs"]:
                self._json({"jobs": self.store.list_jobs()})
            elif len(parts) == 3 and parts[:2] == ["api", "jobs"]:
                self._json({"job": self.store.describe(parts[2])})
            elif len(parts) == 5 and parts[:2] == ["api", "jobs"] and parts[3] == "files":
                download_path = self.store.download_path(parts[2], parts[4])
                content_type = "text/plain; charset=utf-8" if parts[4] == "txt" else "application/x-ndjson"
                self._send_file(download_path, content_type, filename=f"{parts[2]}-{download_path.name}")
            else:
                self._error(BatchToolError("找不到页面或接口。"), 404)
        except (BatchToolError, OSError, ValueError) as exc:
            self._error(exc)
        except Exception as exc:
            self._error(BatchToolError(f"读取失败（{type(exc).__name__}）：{exc}"), 500)

    def do_POST(self) -> None:
        if not self._allowed_host():
            self._error(BatchToolError("仅允许通过本机地址访问。"), 403)
            return
        if self.headers.get("X-Gemini-Batch-UI") != "1":
            self._error(BatchToolError("缺少本地页面请求标识。"), 403)
            return
        origin = self.headers.get("Origin")
        expected = f"http://{self.headers.get('Host')}"
        if origin and origin != expected:
            self._error(BatchToolError("请求来源与本地服务不一致。"), 403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY_BYTES:
                raise BatchToolError("请求体为空或过大（上限 22 MiB）。")
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict):
                raise BatchToolError("请求体必须是 JSON 对象。")
            parts = self._parts()
            if parts == ["api", "jobs"]:
                self._json({"job": self.store.create(payload)}, 201)
            elif len(parts) == 4 and parts[:2] == ["api", "jobs"]:
                job_id, action = parts[2], parts[3]
                if action == "pages":
                    self._json(self.store.add_page(job_id, payload))
                elif action == "prepare":
                    self._json(self.store.prepare(job_id))
                elif action == "submit":
                    self._json({"job": self.store.submit(job_id)})
                elif action == "refresh":
                    self._json({"job": self.store.refresh(job_id)})
                elif action == "fetch":
                    self._json(self.store.fetch(job_id))
                elif action == "retry":
                    self._json(self.store.retry_failed(job_id))
                else:
                    self._error(BatchToolError("未知的操作。"), 404)
            else:
                self._error(BatchToolError("找不到接口。"), 404)
        except (BatchToolError, OSError, ValueError, json.JSONDecodeError) as exc:
            self._error(exc)
        except Exception as exc:
            self._error(BatchToolError(f"操作失败（{type(exc).__name__}）：{exc}"), 502)


def main() -> None:
    parser = argparse.ArgumentParser(description="Gemini Batch OCR 本地可视化服务")
    parser.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1", "localhost"])
    parser.add_argument("--port", type=int, default=8795)
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    args = parser.parse_args()
    store = LocalBatchStore(args.data_dir, key_source=configure_api_key())
    handler = partial(BatchPageHandler, store=store)
    server = ThreadingHTTPServer((args.host, args.port), handler)
    store.start_background()
    print(f"Gemini Batch 本地页面：http://{args.host}:{args.port}/gemini-batch.html", flush=True)
    print(f"任务资料目录：{store.data_dir}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

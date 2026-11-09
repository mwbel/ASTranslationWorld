#!/usr/bin/env python3
"""Prepare, submit, poll, and download Gemini Batch API image/text jobs.

The prepare command is fully local. The submit command uploads the generated
JSONL to Google's File API and creates a billable asynchronous Batch job.
"""

from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


DEFAULT_MODEL = "gemini-4-argon"
MAX_JSONL_BYTES = 2 * 1024**3
MAX_INLINE_REQUEST_BYTES = 20 * 1024**2
TERMINAL_STATES = {
    "JOB_STATE_SUCCEEDED",
    "JOB_STATE_FAILED",
    "JOB_STATE_CANCELLED",
    "JOB_STATE_EXPIRED",
}
SUPPORTED_IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


class BatchToolError(RuntimeError):
    """An actionable local or Gemini API error."""


def _natural_key(value: str) -> list[object]:
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value)]


def _read_prompt(path: str | Path | None) -> str:
    if path is None:
        return ""
    prompt = Path(path).expanduser().read_text(encoding="utf-8-sig").strip()
    return prompt


def _manifest_records(manifest_path: Path) -> Iterable[dict[str, Any]]:
    seen: set[str] = set()
    with manifest_path.open("r", encoding="utf-8-sig") as stream:
        for line_number, raw_line in enumerate(stream, start=1):
            if not raw_line.strip():
                continue
            try:
                item = json.loads(raw_line)
            except json.JSONDecodeError as exc:
                raise BatchToolError(f"清单第 {line_number} 行不是有效 JSON：{exc.msg}") from exc
            if not isinstance(item, dict):
                raise BatchToolError(f"清单第 {line_number} 行必须是 JSON 对象。")
            key = str(item.get("key", "")).strip()
            if not key:
                raise BatchToolError(f"清单第 {line_number} 行缺少非空 key。")
            if key in seen:
                raise BatchToolError(f"清单中 key 重复：{key}")
            seen.add(key)
            yield item


def _image_paths(item: dict[str, Any], base_dir: Path, line_number: int) -> list[Path]:
    raw_images = item.get("images", item.get("image", []))
    if isinstance(raw_images, str):
        raw_images = [raw_images]
    if not isinstance(raw_images, list) or any(not isinstance(value, str) for value in raw_images):
        raise BatchToolError(f"清单第 {line_number} 行的 image/images 必须是路径或路径数组。")

    paths: list[Path] = []
    for raw_path in raw_images:
        path = Path(raw_path).expanduser()
        if not path.is_absolute():
            path = base_dir / path
        if not path.is_file():
            raise BatchToolError(f"清单第 {line_number} 行找不到图片：{path}")
        mime_type = mimetypes.guess_type(path.name)[0]
        if mime_type not in SUPPORTED_IMAGE_MIMES:
            raise BatchToolError(f"不支持的图片类型：{path.name}（检测到 {mime_type or '未知类型'}）")
        paths.append(path)
    return paths


def _image_part(path: Path) -> dict[str, Any]:
    mime_type = mimetypes.guess_type(path.name)[0]
    if mime_type not in SUPPORTED_IMAGE_MIMES:
        raise BatchToolError(f"不支持的图片类型：{path.name}（检测到 {mime_type or '未知类型'}）")
    return {
        "inlineData": {
            "mimeType": mime_type,
            "data": base64.b64encode(path.read_bytes()).decode("ascii"),
        }
    }


def _request_for_record(
    item: dict[str, Any],
    *,
    base_dir: Path,
    default_prompt: str,
    line_number: int,
    temperature: float | None,
    max_output_tokens: int | None,
) -> dict[str, Any]:
    key = str(item["key"]).strip()
    prompt = str(item.get("prompt") or default_prompt).strip()
    source_text = item.get("text", "")
    if source_text is not None and not isinstance(source_text, str):
        raise BatchToolError(f"清单第 {line_number} 行的 text 必须是字符串。")
    images = _image_paths(item, base_dir, line_number)
    if not prompt:
        raise BatchToolError(f"清单第 {line_number} 行没有 prompt，且未提供默认提示词文件。")
    if not images and not str(source_text or "").strip():
        raise BatchToolError(f"清单第 {line_number} 行必须提供图片或非空 text。")

    parts: list[dict[str, Any]] = [{"text": prompt}]
    if str(source_text or "").strip():
        parts.append({"text": source_text})
    parts.extend(_image_part(path) for path in images)
    request: dict[str, Any] = {"contents": [{"role": "user", "parts": parts}]}

    generation_config = item.get("generationConfig", item.get("generation_config", {}))
    if generation_config is not None and not isinstance(generation_config, dict):
        raise BatchToolError(f"清单第 {line_number} 行的 generation_config 必须是 JSON 对象。")
    config = dict(generation_config or {})
    if temperature is not None:
        config.setdefault("temperature", temperature)
    if max_output_tokens is not None:
        config.setdefault("maxOutputTokens", max_output_tokens)
    if config:
        request["generationConfig"] = config

    encoded_size = len(json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    if encoded_size > MAX_INLINE_REQUEST_BYTES:
        raise BatchToolError(
            f"清单第 {line_number} 行请求约 {encoded_size / 1024**2:.1f} MiB，超过内嵌图片请求的 20 MiB 限制；请缩小图片后再打包。"
        )
    return {"key": key, "request": request}


def _image_directory_items(directory: Path, recursive: bool) -> list[dict[str, str]]:
    if not directory.is_dir():
        raise BatchToolError(f"图片目录不存在：{directory}")
    candidates = directory.rglob("*") if recursive else directory.iterdir()
    images = [
        path for path in candidates
        if path.is_file() and mimetypes.guess_type(path.name)[0] in SUPPORTED_IMAGE_MIMES
    ]
    images.sort(key=lambda path: _natural_key(path.relative_to(directory).as_posix()))
    if not images:
        raise BatchToolError(f"目录中没有 PNG/JPEG/WebP/GIF 图片：{directory}")
    return [
        {"key": f"page-{index:04d}", "image": path.as_posix()}
        for index, path in enumerate(images, start=1)
    ]


def _atomic_write_jsonl(output: Path, rows: Iterable[dict[str, Any]], *, overwrite: bool) -> int:
    output = output.expanduser()
    if output.exists() and not overwrite:
        raise BatchToolError(f"输出文件已存在：{output}（如要替换，请添加 --overwrite）")
    output.parent.mkdir(parents=True, exist_ok=True)
    temp_name: str | None = None
    total_bytes = 0
    count = 0
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", newline="\n", dir=output.parent, delete=False) as stream:
            temp_name = stream.name
            for row in rows:
                line = json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
                encoded_size = len(line.encode("utf-8"))
                total_bytes += encoded_size
                if total_bytes > MAX_JSONL_BYTES:
                    raise BatchToolError("JSONL 文件超过 Gemini Batch API 的 2 GiB 文件上限。")
                stream.write(line)
                count += 1
        if count == 0:
            raise BatchToolError("没有可打包的请求。")
        os.replace(temp_name, output)
        temp_name = None
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)
    return count


def prepare_jsonl(
    *,
    output: str | Path,
    manifest: str | Path | None = None,
    images_dir: str | Path | None = None,
    prompt_file: str | Path | None = None,
    recursive: bool = False,
    temperature: float | None = None,
    max_output_tokens: int | None = None,
    overwrite: bool = False,
) -> int:
    if bool(manifest) == bool(images_dir):
        raise BatchToolError("必须且只能提供 --manifest 或 --images-dir 其中一个。")
    default_prompt = _read_prompt(prompt_file)
    if images_dir:
        base_dir = Path(images_dir).expanduser().resolve()
        items: Iterable[dict[str, Any]] = _image_directory_items(base_dir, recursive)
    else:
        manifest_path = Path(manifest).expanduser().resolve()  # type: ignore[arg-type]
        if not manifest_path.is_file():
            raise BatchToolError(f"清单文件不存在：{manifest_path}")
        base_dir = manifest_path.parent
        items = _manifest_records(manifest_path)

    def rows() -> Iterable[dict[str, Any]]:
        for line_number, item in enumerate(items, start=1):
            yield _request_for_record(
                item,
                base_dir=base_dir,
                default_prompt=default_prompt,
                line_number=line_number,
                temperature=temperature,
                max_output_tokens=max_output_tokens,
            )

    return _atomic_write_jsonl(Path(output), rows(), overwrite=overwrite)


def _sdk_client() -> Any:
    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise BatchToolError("请先在当前终端设置 GEMINI_API_KEY；脚本不会把密钥写入文件。")
    try:
        from google import genai
    except ImportError as exc:
        raise BatchToolError("缺少 google-genai，请安装 requirements-gemini-batch.txt。") from exc
    return genai.Client(api_key=api_key)


def _state_write(path: Path, data: dict[str, Any]) -> None:
    path = path.expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            temp_name = stream.name
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.replace(temp_name, path)
        temp_name = None
    finally:
        if temp_name:
            Path(temp_name).unlink(missing_ok=True)


def _state_read(path: str | Path) -> tuple[Path, dict[str, Any]]:
    state_path = Path(path).expanduser()
    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise BatchToolError(f"找不到任务状态文件：{state_path}") from exc
    except json.JSONDecodeError as exc:
        raise BatchToolError(f"任务状态文件不是有效 JSON：{state_path}") from exc
    if not isinstance(state, dict) or not state.get("job_name"):
        raise BatchToolError("状态文件缺少 job_name。")
    return state_path, state


def _enum_name(value: Any) -> str:
    return str(getattr(value, "name", value or "UNKNOWN"))


def record_submission_error(state_path: Path, exc: Exception, stage: str) -> dict[str, Any]:
    message = str(exc)
    for name in ("GEMINI_API_KEY", "GEMINI_API_KEYS", "GOOGLE_API_KEY"):
        for secret in os.environ.get(name, "").split(","):
            if secret.strip():
                message = message.replace(secret.strip(), "[已隐藏的密钥]")
    message = re.sub(r"AIza[\w-]+", "[已隐藏的密钥]", message)
    detail = {"stage": stage, "type": type(exc).__name__, "http_code": getattr(exc, "code", None),
              "message": message[:8000], "recorded_at": datetime.now(timezone.utc).isoformat()}
    _state_write(state_path.with_name("submission-error.json"), detail)
    return detail


def submit_batch(
    input_jsonl: str | Path,
    state_file: str | Path,
    *,
    model: str = DEFAULT_MODEL,
    display_name: str | None = None,
    uploaded_file_name: str | None = None,
) -> dict[str, Any]:
    input_path = Path(input_jsonl).expanduser().resolve()
    state_path = Path(state_file).expanduser()
    if not input_path.is_file():
        raise BatchToolError(f"找不到 JSONL 输入文件：{input_path}")
    validate_jsonl(input_path)
    if state_path.exists():
        raise BatchToolError(f"状态文件已存在，为避免覆盖其他任务而停止：{state_path}")
    client = _sdk_client()
    from google.genai import types

    stage = "upload"
    try:
        if not uploaded_file_name:
            uploaded = client.files.upload(
                file=str(input_path),
                config=types.UploadFileConfig(display_name=input_path.stem, mime_type="jsonl"),
            )
            uploaded_file_name = uploaded.name
        if not uploaded_file_name:
            raise BatchToolError("Files API 没有返回文件名，未创建 Batch 任务。")
        _state_write(state_path.with_name("uploaded-file.json"), {"file_name": uploaded_file_name})
        stage = "create_batch"
        job = client.batches.create(
            model=model, src=uploaded_file_name,
            config={"display_name": display_name or input_path.stem},
        )
    except Exception as exc:
        detail = record_submission_error(state_path, exc, stage)
        raise BatchToolError(f"{stage} 失败（HTTP {detail['http_code']}）：{detail['message']}") from exc
    if not job.name:
        raise BatchToolError("Batch API 没有返回任务名。请到 AI Studio 核对是否已创建任务。")
    state = {
        "job_name": job.name,
        "model": model,
        "display_name": display_name or input_path.stem,
        "input_jsonl": str(input_path),
        "uploaded_file_name": uploaded_file_name,
        "state": _enum_name(job.state),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    _state_write(state_path, state)
    return state


def check_status(state_file: str | Path, *, wait: bool = False, poll_seconds: int = 30, timeout_seconds: int = 0) -> dict[str, Any]:
    if poll_seconds < 1:
        raise BatchToolError("--poll-seconds 必须至少为 1。")
    state_path, state = _state_read(state_file)
    client = _sdk_client()
    deadline = time.monotonic() + timeout_seconds if timeout_seconds > 0 else None
    while True:
        job = client.batches.get(name=state["job_name"])
        current_state = _enum_name(job.state)
        state["state"] = current_state
        state["last_checked_at"] = datetime.now(timezone.utc).isoformat()
        state["error"] = str(job.error) if job.error else None
        if job.dest and job.dest.file_name:
            state["result_file_name"] = job.dest.file_name
        _state_write(state_path, state)
        print(f'{state["job_name"]}: {current_state}')
        if job.error:
            print(f"任务错误：{job.error}")
        if current_state in TERMINAL_STATES or not wait:
            return state
        if deadline is not None and time.monotonic() >= deadline:
            print("已达到本次轮询时限；任务仍在运行，可稍后再次执行 status。")
            return state
        delay = poll_seconds
        if deadline is not None:
            delay = min(delay, max(0, int(deadline - time.monotonic())))
        if delay <= 0:
            return state
        time.sleep(delay)


def _extract_result_text(line: dict[str, Any]) -> tuple[str, str | None]:
    if line.get("error"):
        return "", json.dumps(line["error"], ensure_ascii=False)
    response = line.get("response")
    if not isinstance(response, dict):
        return "", "Batch 返回行缺少 response 或 error 字段。"
    candidates = response.get("candidates") or []
    parts: list[str] = []
    if candidates and isinstance(candidates[0], dict):
        content = candidates[0].get("content") or {}
        for part in content.get("parts") or []:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
    text = "\n".join(part for part in parts if part.strip()).strip()
    if text:
        return text, None
    feedback = response.get("promptFeedback") or {}
    reason = feedback.get("blockReason") if isinstance(feedback, dict) else None
    return "", f"Batch 响应没有可用文本{f'（{reason}）' if reason else ''}。"


def parse_result_jsonl(content: bytes | str) -> list[dict[str, str | None]]:
    if isinstance(content, bytes):
        content = content.decode("utf-8-sig")
    results: list[dict[str, str | None]] = []
    for line_number, raw_line in enumerate(content.splitlines(), start=1):
        if not raw_line.strip():
            continue
        try:
            parsed = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            raise BatchToolError(f"结果 JSONL 第 {line_number} 行无法解析：{exc.msg}") from exc
        if not isinstance(parsed, dict):
            raise BatchToolError(f"结果 JSONL 第 {line_number} 行不是对象。")
        text, error = _extract_result_text(parsed)
        results.append({"key": str(parsed.get("key") or f"request-{line_number:04d}"), "text": text, "error": error})
    return results


def render_text_results(results: list[dict[str, str | None]]) -> str:
    def order(item: tuple[int, dict[str, str | None]]) -> tuple[int, int, int]:
        original_index, row = item
        match = re.search(r"(?:page|p|页)[-_ ]*0*(\d+)", str(row.get("key", "")), re.I)
        return (0, int(match.group(1)), original_index) if match else (1, original_index, original_index)

    blocks: list[str] = []
    for _, item in sorted(enumerate(results), key=order):
        key = str(item.get("key", ""))
        match = re.search(r"(?:page|p|页)[-_ ]*0*(\d+)", key, re.I)
        heading = f"第 {int(match.group(1))} 页" if match else f"任务 {key}"
        body = str(item.get("text") or "").strip()
        if item.get("error"):
            body = f"[识别失败] {item['error']}"
        blocks.append(f"{heading}\n{body}".rstrip())
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def download_results(
    state_file: str | Path,
    *,
    output_jsonl: str | Path,
    output_text: str | Path | None = None,
) -> list[dict[str, str | None]]:
    state_path, state = _state_read(state_file)
    client = _sdk_client()
    job = client.batches.get(name=state["job_name"])
    current_state = _enum_name(job.state)
    state["state"] = current_state
    if current_state != "JOB_STATE_SUCCEEDED":
        raise BatchToolError(f"任务尚未成功，当前状态为 {current_state}，不能下载结果。")
    if not job.dest or not job.dest.file_name:
        raise BatchToolError("成功任务没有可下载的结果文件。")
    raw = client.files.download(file=job.dest.file_name)
    if not isinstance(raw, bytes):
        raise BatchToolError("SDK 下载结果不是字节数据。")
    parsed = parse_result_jsonl(raw)
    json_path = Path(output_jsonl).expanduser()
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_bytes(raw)
    if output_text:
        text_path = Path(output_text).expanduser()
        text_path.parent.mkdir(parents=True, exist_ok=True)
        text_path.write_text(render_text_results(parsed), encoding="utf-8")
    state["result_file_name"] = job.dest.file_name
    state["downloaded_jsonl"] = str(json_path.resolve())
    state["downloaded_at"] = datetime.now(timezone.utc).isoformat()
    _state_write(state_path, state)
    return parsed


def validate_jsonl(path: str | Path) -> int:
    jsonl_path = Path(path)
    if jsonl_path.stat().st_size > MAX_JSONL_BYTES:
        raise BatchToolError("JSONL 文件超过 Gemini Batch API 的 2 GiB 文件上限。")
    count = 0
    seen: set[str] = set()
    with jsonl_path.open("r", encoding="utf-8-sig") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise BatchToolError(f"JSONL 第 {line_number} 行无法解析：{exc.msg}") from exc
            if not isinstance(row, dict) or not isinstance(row.get("request"), dict):
                raise BatchToolError(f"JSONL 第 {line_number} 行需包含 request 对象。")
            key = str(row.get("key", "")).strip()
            if not key or key in seen:
                raise BatchToolError(f"JSONL 第 {line_number} 行缺少 key 或 key 重复。")
            seen.add(key)
            count += 1
    if count == 0:
        raise BatchToolError("JSONL 文件没有请求记录。")
    return count


def _add_common_generation_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--temperature", type=float, help="可选的采样温度，例如 0.1。")
    parser.add_argument("--max-output-tokens", type=int, help="可选的单请求最大输出 token 数。")


def make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Gemini 4 图片识别/文本翻译 Batch API 离线工具")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare", help="本地打包图片或文本清单为 Gemini JSONL，不上传")
    source = prepare.add_mutually_exclusive_group(required=True)
    source.add_argument("--images-dir", help="图片目录；按文件名自然排序，自动生成 page-0001 等请求 key。")
    source.add_argument("--manifest", help="UTF-8 JSONL 清单；每行包含 key、prompt，以及 image/images 或 text。")
    prepare.add_argument("--prompt-file", help="统一提示词文件；manifest 行可用自己的 prompt 覆盖。")
    prepare.add_argument("--recursive", action="store_true", help="递归扫描图片目录。")
    prepare.add_argument("--output", required=True, help="输出 JSONL 路径。")
    prepare.add_argument("--overwrite", action="store_true", help="允许覆盖已存在的 JSONL 文件。")
    _add_common_generation_args(prepare)

    submit = subparsers.add_parser("submit", help="上传 JSONL 并创建 Gemini Batch 任务（会向 Google 上传数据并产生模型费用）")
    submit.add_argument("--input", required=True, help="prepare 生成的 JSONL 文件。")
    submit.add_argument("--state", required=True, help="本地任务状态 JSON 路径；必须不存在。")
    submit.add_argument("--model", default=DEFAULT_MODEL, help=f"Gemini 模型名（默认 {DEFAULT_MODEL}）。")
    submit.add_argument("--display-name", help="Batch 任务显示名称。")

    status = subparsers.add_parser("status", help="查看任务状态；可选持续轮询")
    status.add_argument("--state", required=True, help="submit 生成的本地任务状态 JSON。")
    status.add_argument("--wait", action="store_true", help="持续轮询至终态。")
    status.add_argument("--poll-seconds", type=int, default=30, help="轮询间隔（默认 30 秒）。")
    status.add_argument("--timeout-seconds", type=int, default=0, help="本次轮询最长时长；0 表示持续等待。")

    download = subparsers.add_parser("download", help="下载已成功任务的结果 JSONL，并可生成按页排序的 TXT")
    download.add_argument("--state", required=True, help="submit 生成的本地任务状态 JSON。")
    download.add_argument("--output-jsonl", required=True, help="原始结果 JSONL 输出路径。")
    download.add_argument("--output-text", help="可选的纯文本输出路径。")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = make_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "prepare":
            count = prepare_jsonl(
                output=args.output,
                manifest=args.manifest,
                images_dir=args.images_dir,
                prompt_file=args.prompt_file,
                recursive=args.recursive,
                temperature=args.temperature,
                max_output_tokens=args.max_output_tokens,
                overwrite=args.overwrite,
            )
            print(f"已打包 {count} 个请求：{Path(args.output).expanduser()}")
            print("此步骤只在本地生成 JSONL，没有上传文件，也没有创建付费任务。")
        elif args.command == "submit":
            state_file = Path(args.state).expanduser()
            if state_file.exists():
                raise BatchToolError(f"状态文件已存在，为避免重复提交而停止：{state_file}")
            state = submit_batch(args.input, state_file, model=args.model, display_name=args.display_name)
            print(f"已创建任务：{state['job_name']} ({state['state']})")
            print(f"状态文件：{state_file}")
        elif args.command == "status":
            check_status(args.state, wait=args.wait, poll_seconds=args.poll_seconds, timeout_seconds=args.timeout_seconds)
        elif args.command == "download":
            rows = download_results(args.state, output_jsonl=args.output_jsonl, output_text=args.output_text)
            errors = sum(1 for row in rows if row.get("error"))
            print(f"已下载 {len(rows)} 条结果，其中 {errors} 条请求失败。")
            print(f"JSONL：{Path(args.output_jsonl).expanduser()}")
            if args.output_text:
                print(f"TXT：{Path(args.output_text).expanduser()}")
        return 0
    except (BatchToolError, OSError, ValueError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
AGGREGATOR_DIR="$(cd "$WORKSPACE_ROOT/../ModelAggregatorService" && pwd)"
RUNTIME_DIR="${TMPDIR:-/tmp}/tibetan-gemini4-compare-${UID}"
AGGREGATOR_PORT=18892
OCR_PORT=18180
PYTHON_BIN="${PYTHON_BIN:-python3}"

port_pid() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

stop_service() {
  local name="$1" port="$2" pid_file="$RUNTIME_DIR/$1.pid" saved_pid="" current_pid=""
  if [ -f "$pid_file" ]; then
    saved_pid="$(cat "$pid_file")"
    current_pid="$(port_pid "$port")"
    if [ -n "$saved_pid" ] && [ "$saved_pid" = "$current_pid" ]; then
      kill "$saved_pid"
      echo "已停止：$name (PID $saved_pid)"
    fi
    rm -f "$pid_file"
  fi
}

wait_for_health() {
  local pid="$1" url="$2" attempt
  for attempt in {1..40}; do
    if ! kill -0 "$pid" 2>/dev/null; then return 1; fi
    if curl --fail --silent --max-time 2 "$url" >/dev/null; then return 0; fi
    sleep 0.25
  done
  return 1
}

start_detached() {
  local log_file="$1"
  shift
  "$PYTHON_BIN" - "$log_file" "$@" <<'PY'
import os
import subprocess
import sys

with open(sys.argv[1], "ab", buffering=0) as log:
    process = subprocess.Popen(
        sys.argv[2:],
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        env=os.environ.copy(),
        start_new_session=True,
        close_fds=True,
    )
print(process.pid)
PY
}

case "${1:-}" in
  stop)
    stop_service ai_ocr "$OCR_PORT"
    stop_service aggregator "$AGGREGATOR_PORT"
    exit 0
    ;;
  start) ;;
  *) echo "用法：$0 start|stop" >&2; exit 2 ;;
esac

if [ -z "${GEMINI_API_KEY:-}" ]; then
  echo "缺少 GEMINI_API_KEY：请先在当前终端设置具备 Gemini 4 Argon 额度的 key。" >&2
  exit 1
fi
if [ -n "$(port_pid "$OCR_PORT")" ] || [ -n "$(port_pid "$AGGREGATOR_PORT")" ]; then
  echo "端口 $OCR_PORT 或 $AGGREGATOR_PORT 已被占用；不会接管其他服务。" >&2
  exit 1
fi

mkdir -p "$RUNTIME_DIR"
aggregator_pid="$(
  GEMINI_API_KEYS="$GEMINI_API_KEY" AGGREGATOR_PORT="$AGGREGATOR_PORT" \
    OCR_CORRECTION_TIMEOUT_SECONDS=300 PYTHONPATH="$AGGREGATOR_DIR${PYTHONPATH:+:$PYTHONPATH}" \
    start_detached "$RUNTIME_DIR/aggregator.log" "$PYTHON_BIN" -m model_aggregator.server
)"
echo "$aggregator_pid" >"$RUNTIME_DIR/aggregator.pid"
if ! wait_for_health "$aggregator_pid" "http://127.0.0.1:$AGGREGATOR_PORT/api/aggregate/health"; then
  echo "Gemini 4 聚合器启动失败；日志：$RUNTIME_DIR/aggregator.log" >&2
  stop_service aggregator "$AGGREGATOR_PORT"
  exit 1
fi

ocr_pid="$(
  AI_VISION_OCR_PORT="$OCR_PORT" AI_VISION_PROVIDER=model_aggregator \
    AI_VISION_MODEL=gemini:gemini-4-argon GEMINI_REVIEW_MODELS=gemini-4-argon \
    MODEL_AGGREGATOR_BASE_URL="http://127.0.0.1:$AGGREGATOR_PORT" \
    AI_VISION_TIMEOUT=330 AI_VISION_MAX_TOKENS=16384 \
    start_detached "$RUNTIME_DIR/ai_ocr.log" "$PYTHON_BIN" \
    "$WORKSPACE_ROOT/tibetan-ocr-core/ai_vision_ocr_server.py"
)"
echo "$ocr_pid" >"$RUNTIME_DIR/ai_ocr.pid"
if ! wait_for_health "$ocr_pid" "http://127.0.0.1:$OCR_PORT/health"; then
  echo "Gemini 4 OCR 服务启动失败；日志：$RUNTIME_DIR/ai_ocr.log" >&2
  stop_service ai_ocr "$OCR_PORT"
  stop_service aggregator "$AGGREGATOR_PORT"
  exit 1
fi

echo "Gemini 4 对照页服务已启动：OCR http://127.0.0.1:$OCR_PORT/health；聚合器 http://127.0.0.1:$AGGREGATOR_PORT/api/aggregate/health"
echo "页面：file://$SCRIPT_DIR/gemini38-compare.html"
echo "停止：$0 stop"

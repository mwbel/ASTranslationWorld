#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="${BDRC_RUNTIME_DIR:-${TMPDIR:-/tmp}/tibetan-proofreading-app-services-${UID}}"

for env_file in "$WORKSPACE_ROOT/.env" "$SCRIPT_DIR/.env" "$WORKSPACE_ROOT/tibetan-translation-services/.env"; do
  if [ -f "$env_file" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$env_file"
    set +a
  fi
done

FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-8790}"
OCR_HOST="${BDRC_OCR_HOST:-127.0.0.1}"
OCR_PORT="${BDRC_OCR_PORT:-18090}"
AI_OCR_HOST="${AI_VISION_OCR_HOST:-127.0.0.1}"
AI_OCR_PORT="${AI_VISION_OCR_PORT:-18092}"
AI_VISION_PROVIDER="${AI_VISION_PROVIDER:-model_aggregator}"
AI_VISION_MODEL="${AI_VISION_MODEL:-gemini:gemini-2.5-flash}"
AI_VISION_ALLOW_FALLBACK="${AI_VISION_ALLOW_FALLBACK:-0}"
MODEL_AGGREGATOR_AUTO_START="${MODEL_AGGREGATOR_AUTO_START:-1}"
MODEL_AGGREGATOR_PORT="${MODEL_AGGREGATOR_PORT:-${AGGREGATOR_PORT:-8890}}"
MODEL_AGGREGATOR_DIR="${MODEL_AGGREGATOR_DIR:-$WORKSPACE_ROOT/../ModelAggregatorService}"
MODEL_AGGREGATOR_BASE_URL="${MODEL_AGGREGATOR_BASE_URL:-http://127.0.0.1:${MODEL_AGGREGATOR_PORT}}"
TRANSLATE_HOST="${NLLB_TRANSLATE_HOST:-127.0.0.1}"
TRANSLATE_PORT="${NLLB_TRANSLATE_PORT:-18091}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

OCR_SCRIPT="$WORKSPACE_ROOT/tibetan-ocr-core/bdrc_ocr_server.py"
AI_OCR_SCRIPT="$WORKSPACE_ROOT/tibetan-ocr-core/ai_vision_ocr_server.py"
TRANSLATION_SCRIPT="$WORKSPACE_ROOT/tibetan-translation-services/nllb_translate_server.py"
FRONTEND_SCRIPT="$SCRIPT_DIR/no_cache_server.py"

export AI_VISION_PROVIDER AI_VISION_MODEL AI_VISION_ALLOW_FALLBACK

mkdir -p "$RUNTIME_DIR"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  echo "错误：找不到 Python：$PYTHON_BIN"
  exit 1
fi

port_pid() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

start_service() {
  name="$1"
  port="$2"
  shift 2

  pid_file="$RUNTIME_DIR/$name.pid"
  log_file="$RUNTIME_DIR/$name.log"

  if [ -f "$pid_file" ]; then
    saved_pid="$(cat "$pid_file" 2>/dev/null || true)"
    if [ -n "$saved_pid" ] && kill -0 "$saved_pid" 2>/dev/null; then
      echo "已运行：$name (PID $saved_pid, 端口 $port)"
      return 0
    fi
    rm -f "$pid_file"
  fi

  existing_pid="$(port_pid "$port")"
  if [ -n "$existing_pid" ]; then
    echo "已占用：端口 $port 已由 PID $existing_pid 监听，复用现有服务"
    return 0
  fi

  service_pid="$(
    "$PYTHON_BIN" - "$log_file" "$@" <<'PY'
import os
import subprocess
import sys

log_file = sys.argv[1]
command = sys.argv[2:]
env = os.environ.copy()
env["PYTHONUNBUFFERED"] = "1"

with open(log_file, "ab", buffering=0) as log:
    process = subprocess.Popen(
        command,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=subprocess.STDOUT,
        env=env,
        start_new_session=True,
        close_fds=True,
    )

print(process.pid)
PY
  )"
  if [ -z "$service_pid" ]; then
    echo "启动失败：$name"
    echo "日志：$log_file"
    tail -n 20 "$log_file" 2>/dev/null || true
    return 1
  fi
  echo "$service_pid" >"$pid_file"

  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if ! kill -0 "$service_pid" 2>/dev/null; then
      echo "启动失败：$name"
      echo "日志：$log_file"
      tail -n 20 "$log_file" 2>/dev/null || true
      rm -f "$pid_file"
      return 1
    fi
    if [ -n "$(port_pid "$port")" ]; then
      echo "已启动：$name (PID $service_pid, 端口 $port)"
      return 0
    fi
    sleep 0.2
    attempt=$((attempt + 1))
  done

  echo "启动超时：$name 尚未监听端口 $port"
  echo "日志：$log_file"
  return 1
}

check_url() {
  label="$1"
  url="$2"
  if curl --silent --show-error --max-time 5 "$url" >/dev/null; then
    echo "检查通过：$label $url"
  else
    echo "检查失败：$label $url"
  fi
}

ensure_frontend_no_cache_service() {
  existing_pid="$(port_pid "$FRONTEND_PORT")"
  if [ -z "$existing_pid" ]; then
    return 0
  fi

  headers="$(curl -I --silent --max-time 3 "http://$FRONTEND_HOST:$FRONTEND_PORT/tibetan-proofreading-app/app.js" 2>/dev/null || true)"
  if printf '%s\n' "$headers" | grep -qi "Cache-Control:.*no-store"; then
    return 0
  fi

  echo "正在替换：端口 $FRONTEND_PORT 上的旧前端静态服务没有 no-store 缓存头 (PID $existing_pid)"
  kill "$existing_pid" 2>/dev/null || true
  rm -f "$RUNTIME_DIR/frontend.pid"
  attempt=0
  while [ "$attempt" -lt 20 ]; do
    if [ -z "$(port_pid "$FRONTEND_PORT")" ]; then
      return 0
    fi
    sleep 0.2
    attempt=$((attempt + 1))
  done
  echo "警告：端口 $FRONTEND_PORT 仍被占用，将尝试继续启动或复用。"
}

uses_model_aggregator() {
  case "$AI_VISION_PROVIDER" in
    model_aggregator|model-aggregator|aggregator) return 0 ;;
    *) return 1 ;;
  esac
}

model_aggregator_health_url() {
  echo "${MODEL_AGGREGATOR_BASE_URL%/}/api/aggregate/health"
}

start_model_aggregator() {
  if ! uses_model_aggregator; then
    return 0
  fi

  if curl --silent --show-error --max-time 3 "$(model_aggregator_health_url)" >/dev/null 2>&1; then
    echo "已运行：ModelAggregatorService (${MODEL_AGGREGATOR_BASE_URL})"
    export MODEL_AGGREGATOR_BASE_URL
    return 0
  fi

  if [ "$MODEL_AGGREGATOR_AUTO_START" = "0" ]; then
    echo "未启动：ModelAggregatorService 不可用，且 MODEL_AGGREGATOR_AUTO_START=0"
    echo "请先启动：cd \"$MODEL_AGGREGATOR_DIR\" && ./start.sh"
    return 1
  fi

  if [ ! -x "$MODEL_AGGREGATOR_DIR/start.sh" ]; then
    echo "未找到：ModelAggregatorService 启动脚本 $MODEL_AGGREGATOR_DIR/start.sh"
    return 1
  fi

  echo "正在启动：ModelAggregatorService ($MODEL_AGGREGATOR_DIR)"
  (
    cd "$MODEL_AGGREGATOR_DIR" &&
      AGGREGATOR_PORT="$MODEL_AGGREGATOR_PORT" ./start.sh
  ) || return 1

  env_file="$MODEL_AGGREGATOR_DIR/.run-logs/aggregator.env"
  if [ -f "$env_file" ]; then
    # shellcheck disable=SC1090
    . "$env_file"
    if [ -n "${AGGREGATOR_URL:-}" ]; then
      MODEL_AGGREGATOR_BASE_URL="$AGGREGATOR_URL"
    fi
  fi

  export MODEL_AGGREGATOR_BASE_URL
  if curl --silent --show-error --max-time 5 "$(model_aggregator_health_url)" >/dev/null 2>&1; then
    echo "检查通过：ModelAggregatorService $(model_aggregator_health_url)"
    return 0
  fi

  echo "检查失败：ModelAggregatorService $(model_aggregator_health_url)"
  return 1
}

echo "运行目录：$RUNTIME_DIR"
echo

failed=0

ensure_frontend_no_cache_service

start_service \
  frontend \
  "$FRONTEND_PORT" \
  "$PYTHON_BIN" "$FRONTEND_SCRIPT" \
  --host "$FRONTEND_HOST" \
  --port "$FRONTEND_PORT" \
  --directory "$WORKSPACE_ROOT" || failed=1

start_service \
  ocr \
  "$OCR_PORT" \
  "$PYTHON_BIN" "$OCR_SCRIPT" || failed=1

start_model_aggregator || failed=1

start_service \
  ai_ocr \
  "$AI_OCR_PORT" \
  "$PYTHON_BIN" "$AI_OCR_SCRIPT" || failed=1

start_service \
  translate \
  "$TRANSLATE_PORT" \
  "$PYTHON_BIN" "$TRANSLATION_SCRIPT" || failed=1

echo
FRONTEND_URL="http://${FRONTEND_HOST}:${FRONTEND_PORT}/tibetan-proofreading-app/"
check_url "前端" "$FRONTEND_URL"
check_url "OCR" "http://${OCR_HOST}:${OCR_PORT}/health"
if uses_model_aggregator; then
  check_url "ModelAggregatorService" "$(model_aggregator_health_url)"
fi
check_url "AI OCR" "http://${AI_OCR_HOST}:${AI_OCR_PORT}/health"
check_url "翻译" "http://${TRANSLATE_HOST}:${TRANSLATE_PORT}/health"

echo
echo "前端地址：$FRONTEND_URL"
echo "日志目录：$RUNTIME_DIR"
echo "停止服务：$SCRIPT_DIR/stop_services.sh"
echo "说明：AI OCR 默认转发到 ModelAggregatorService，可用 AI_VISION_* 环境变量切换模型；翻译模型首次启动需要下载并加载。"

if [ "${OPEN_BROWSER:-1}" != "0" ] && command -v open >/dev/null 2>&1; then
  open "$FRONTEND_URL"
fi

exit "$failed"

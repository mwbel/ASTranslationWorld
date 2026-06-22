#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="${BDRC_RUNTIME_DIR:-${TMPDIR:-/tmp}/bdrc-ocr-compare-services-${UID}}"

FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-8790}"
OCR_HOST="${BDRC_OCR_HOST:-127.0.0.1}"
OCR_PORT="${BDRC_OCR_PORT:-18090}"
TRANSLATE_HOST="${NLLB_TRANSLATE_HOST:-127.0.0.1}"
TRANSLATE_PORT="${NLLB_TRANSLATE_PORT:-18091}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

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

  nohup env PYTHONUNBUFFERED=1 "$@" >"$log_file" 2>&1 </dev/null &
  service_pid=$!
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

echo "运行目录：$RUNTIME_DIR"
echo

failed=0

start_service \
  frontend \
  "$FRONTEND_PORT" \
  "$PYTHON_BIN" -m http.server "$FRONTEND_PORT" \
  --bind "$FRONTEND_HOST" \
  --directory "$PROJECT_ROOT" || failed=1

start_service \
  ocr \
  "$OCR_PORT" \
  "$PYTHON_BIN" "$SCRIPT_DIR/bdrc_ocr_server.py" || failed=1

start_service \
  translate \
  "$TRANSLATE_PORT" \
  "$PYTHON_BIN" "$SCRIPT_DIR/nllb_translate_server.py" || failed=1

echo
FRONTEND_URL="http://${FRONTEND_HOST}:${FRONTEND_PORT}/bdrc-ocr-compare/"
check_url "前端" "$FRONTEND_URL"
check_url "OCR" "http://${OCR_HOST}:${OCR_PORT}/health"
check_url "翻译" "http://${TRANSLATE_HOST}:${TRANSLATE_PORT}/health"

echo
echo "前端地址：$FRONTEND_URL"
echo "日志目录：$RUNTIME_DIR"
echo "停止服务：$SCRIPT_DIR/stop_services.sh"
echo "说明：翻译模型首次启动需要下载并加载，/health 返回 loading 时请等待。"

if [ "${OPEN_BROWSER:-1}" != "0" ] && command -v open >/dev/null 2>&1; then
  open "$FRONTEND_URL"
fi

exit "$failed"

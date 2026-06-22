#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="${BDRC_RUNTIME_DIR:-${TMPDIR:-/tmp}/bdrc-ocr-compare-services-${UID}}"

stop_service() {
  name="$1"
  pid_file="$RUNTIME_DIR/$name.pid"

  if [ ! -f "$pid_file" ]; then
    echo "未记录：$name"
    return
  fi

  service_pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [ -z "$service_pid" ] || ! kill -0 "$service_pid" 2>/dev/null; then
    echo "已停止：$name"
    rm -f "$pid_file"
    return
  fi

  kill "$service_pid" 2>/dev/null || true
  attempt=0
  while kill -0 "$service_pid" 2>/dev/null && [ "$attempt" -lt 20 ]; do
    sleep 0.25
    attempt=$((attempt + 1))
  done

  if kill -0 "$service_pid" 2>/dev/null; then
    kill -9 "$service_pid" 2>/dev/null || true
  fi

  rm -f "$pid_file"
  echo "已停止：$name (PID $service_pid)"
}

stop_service frontend
stop_service ocr
stop_service translate

echo "日志保留在：$RUNTIME_DIR"

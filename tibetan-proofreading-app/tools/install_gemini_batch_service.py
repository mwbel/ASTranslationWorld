#!/usr/bin/env python3
"""Install and control the local Gemini Batch page as a macOS LaunchAgent."""

from __future__ import annotations

import argparse
import os
import plistlib
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import urlopen


LABEL = "com.min369.tibetan-gemini-batch"
PORT = 8795
PAGE_URL = f"http://127.0.0.1:{PORT}/gemini-batch.html"
HEALTH_URL = f"http://127.0.0.1:{PORT}/api/health"
APP_DIR = Path(__file__).resolve().parents[1]
SERVER = APP_DIR / "tools" / "gemini_batch_web.py"
PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
LOG_DIR = Path.home() / "Library" / "Logs" / "TibetanGeminiBatch"
TARGET = f"gui/{os.getuid()}/{LABEL}"
DOMAIN = f"gui/{os.getuid()}"


def _launchctl(*arguments: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["/bin/launchctl", *arguments], text=True, capture_output=True, check=check)


def _loaded() -> bool:
    return _launchctl("print", TARGET, check=False).returncode == 0


def _healthy() -> bool:
    try:
        with urlopen(HEALTH_URL, timeout=2) as response:
            return response.status == 200
    except (OSError, URLError):
        return False


def _port_occupied() -> bool:
    with socket.socket() as connection:
        connection.settimeout(1)
        return connection.connect_ex(("127.0.0.1", PORT)) == 0


def install() -> None:
    if sys.platform != "darwin":
        raise RuntimeError("此启动配置仅适用于 macOS。")
    if not SERVER.is_file():
        raise RuntimeError(f"找不到服务脚本：{SERVER}")
    if _port_occupied() and not _loaded():
        raise RuntimeError(f"端口 {PORT} 已被其他程序占用；不会接管该进程。")

    PLIST.parent.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    config = {
        "Label": LABEL,
        "ProgramArguments": [sys.executable, str(SERVER), "--port", str(PORT)],
        "WorkingDirectory": str(APP_DIR.parent),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 5,
        "EnvironmentVariables": {"PYTHONUNBUFFERED": "1"},
        "StandardOutPath": str(LOG_DIR / "out.log"),
        "StandardErrorPath": str(LOG_DIR / "error.log"),
    }
    if _loaded():
        result = _launchctl("bootout", TARGET, check=False)
        if result.returncode != 0:
            raise RuntimeError(f"无法重启旧服务：{result.stderr.strip()}")
    with PLIST.open("wb") as stream:
        plistlib.dump(config, stream)
    PLIST.chmod(0o644)
    result = _launchctl("bootstrap", DOMAIN, str(PLIST), check=False)
    if result.returncode != 0:
        raise RuntimeError(f"LaunchAgent 安装失败：{result.stderr.strip()}")
    for _ in range(40):
        if _healthy():
            print(f"已启动：{PAGE_URL}")
            print(f"启动配置：{PLIST}")
            return
        time.sleep(0.25)
    raise RuntimeError(f"服务已注册但尚未通过健康检查；请查看 {LOG_DIR / 'error.log'}")


def status() -> int:
    loaded = _loaded()
    healthy = _healthy()
    print(f"LaunchAgent：{'已加载' if loaded else '未加载'}")
    print(f"HTTP：{'可访问' if healthy else '不可访问'}")
    print(f"页面：{PAGE_URL}")
    return 0 if loaded and healthy else 1


def stop() -> None:
    if _loaded():
        result = _launchctl("bootout", TARGET, check=False)
        if result.returncode != 0:
            raise RuntimeError(f"停止失败：{result.stderr.strip()}")
    print("Gemini Batch 本地服务已停止。下次登录仍会由 LaunchAgent 自动启动。")


def main() -> int:
    parser = argparse.ArgumentParser(description="安装或管理 Gemini Batch 本地开机启动服务")
    parser.add_argument("action", choices=["install", "status", "stop"])
    action = parser.parse_args().action
    try:
        if action == "install":
            install()
        elif action == "status":
            return status()
        else:
            stop()
        return 0
    except (OSError, RuntimeError, subprocess.CalledProcessError) as exc:
        print(f"错误：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Prompt locally for Qwen credentials; restart only this workspace's AI service.

By default, save shell environment assignments in a Git-ignored, owner-only
local file. --session-only retains the previous process-lifetime behaviour.
The key is never printed or passed on the command line.
"""
import argparse
import getpass
import json
import os
from pathlib import Path
import signal
import shlex
import tempfile
import subprocess
import sys
import time
from urllib.parse import urlparse
from urllib.request import urlopen

WORKSPACE = Path(__file__).resolve().parent.parent
SERVER = WORKSPACE / 'tibetan-ocr-core' / 'ai_vision_ocr_server.py'
CONFIG_PATH = WORKSPACE / 'tibetan-proofreading-app' / '.qwen-review.env'


def validate_inputs(base_url, key):
    parsed = urlparse(base_url)
    host = parsed.hostname or ''
    if (parsed.scheme != 'https' or not (host.endswith('.aliyuncs.com') or host.endswith('.qianwenai.com'))
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise ValueError('请输入控制台提供的官方 HTTPS Base URL，不要在地址中包含 key。')
    if not key.startswith('sk-') or any(char.isspace() for char in key) or len(key) < 16:
        raise ValueError('key 格式不正确，请粘贴完整 key；不会显示或保存它。')
    return base_url.rstrip('/'), key


def load_saved_config(path=None):
    path = Path(path) if path is not None else CONFIG_PATH
    if not path.exists():
        return {}
    values = {}
    for line in path.read_text().splitlines():
        name, sep, value = line.partition('=')
        if sep and name in {'QWEN_REVIEW_API_KEY', 'QWEN_REVIEW_BASE_URL'}:
            tokens = shlex.split(value)
            if len(tokens) == 1:
                values[name] = tokens[0]
    return values


def save_config(base_url, key, path=None):
    base_url, key = validate_inputs(base_url, key)
    path = Path(path) if path is not None else CONFIG_PATH
    # Atomic owner-only creation; never expose a partially written credential.
    descriptor, temporary = tempfile.mkstemp(prefix='.qwen-review-', dir=path.parent)
    try:
        with os.fdopen(descriptor, 'w') as output:
            output.write('QWEN_REVIEW_API_KEY=' + shlex.quote(key) + '\n')
            output.write('QWEN_REVIEW_BASE_URL=' + shlex.quote(base_url) + '\n')
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def stop_workspace_ai(runtime, port):
    result = subprocess.run(['lsof', '-t', f'-iTCP:{port}', '-sTCP:LISTEN'], capture_output=True, text=True)
    listeners = result.stdout.split()
    if not listeners:
        return
    pid_path = runtime / 'ai_ocr.pid'
    saved = pid_path.read_text().strip() if pid_path.exists() else ''
    if len(listeners) != 1 or listeners[0] != saved or not saved.isdigit():
        raise RuntimeError('AI 端口由未确认的进程占用，未停止任何服务。')
    command = subprocess.run(['ps', '-p', saved, '-o', 'command='], capture_output=True, text=True).stdout
    if str(SERVER) not in command:
        raise RuntimeError('PID 不属于本工作区 AI 服务，未停止任何服务。')
    os.kill(int(saved), signal.SIGTERM)
    for _ in range(40):
        check = subprocess.run(['lsof', '-t', f'-iTCP:{port}', '-sTCP:LISTEN'], capture_output=True, text=True)
        if not check.stdout.strip():
            return
        time.sleep(.1)
    raise RuntimeError('原 AI 服务未退出，未启动重复服务。')


def configure(base_url, key):
    base_url, key = validate_inputs(base_url, key)
    runtime = Path(os.environ.get('BDRC_RUNTIME_DIR') or f"{os.environ.get('TMPDIR', '/tmp')}/tibetan-proofreading-app-services-{os.getuid()}")
    port = int(os.environ.get('AI_VISION_OCR_PORT', '18092'))
    stop_workspace_ai(runtime, port)
    runtime.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.update(QWEN_REVIEW_API_KEY=key, QWEN_REVIEW_BASE_URL=base_url, PYTHONUNBUFFERED='1')
    defaults = {'AI_VISION_PROVIDER': 'model_aggregator', 'AI_VISION_MODEL': 'gemini:gemini-2.5-flash',
                'AI_VISION_MODELS': 'gemini:gemini-2.5-flash,gemini:gemini-3.1-flash-lite,gemini:gemini-2.0-flash,gemini:gemini-flash-latest',
                'AI_VISION_ALLOW_FALLBACK': '0', 'AI_VISION_TIMEOUT': '180', 'AI_VISION_MAX_IMAGE_SIDE': '1800'}
    for name, value in defaults.items():
        env.setdefault(name, value)
    with (runtime / 'ai_ocr.log').open('ab', buffering=0) as log:
        process = subprocess.Popen([sys.executable, str(SERVER)], cwd=WORKSPACE, env=env,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    (runtime / 'ai_ocr.pid').write_text(str(process.pid))
    for _ in range(40):
        if process.poll() is not None:
            raise RuntimeError('AI 服务启动失败；请检查本地 AI 服务日志。')
        try:
            with urlopen(f'http://127.0.0.1:{port}/review-models', timeout=2) as response:
                catalog = json.load(response)
            if catalog.get('qwen', {}).get('configured'):
                return
        except OSError:
            pass
        time.sleep(.1)
    raise RuntimeError('未收到千问已配置状态，请检查 AI 服务。')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default=os.environ.get('QWEN_REVIEW_BASE_URL', ''))
    parser.add_argument('--session-only', action='store_true', help='只配置当前服务进程，不保存')
    args = parser.parse_args()
    print('仅配置本地千问复核，不调用外部模型；API key 隐藏输入。')
    try:
        saved = {} if args.session_only else load_saved_config()
        base_url = args.base_url or saved.get('QWEN_REVIEW_BASE_URL') or input('粘贴百炼 API Key 页的按量付费 Base URL：').strip()
        key = (os.environ.get('QWEN_REVIEW_API_KEY') or os.environ.get('DASHSCOPE_API_KEY')
               or saved.get('QWEN_REVIEW_API_KEY') or getpass.getpass('千问 API key（输入不显示，粘贴后按回车）：').strip())
        base_url, key = validate_inputs(base_url, key)
        if not args.session_only:
            save_config(base_url, key)
        configure(base_url, key)
    except (ValueError, RuntimeError) as error:
        print(f'配置未完成：{error}')
        return 1
    except OSError:
        print('配置或启动未完成。请检查本工作区 AI 服务状态；未输出 key。')
        return 1
    print('千问后端已配置。刷新工作台后点击“千问复核”即可。')
    print('http://127.0.0.1:8790/tibetan-proofreading-app/?workflow=ocr')
    print('本次仅配置当前进程；重启后需重新输入。' if args.session_only else '已持久保存本地环境变量（权限600，Git忽略）；启动脚本重启时自动加载。')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

# tibetan-proofreading-app

This repository is the user-facing proofreading workbench.

## Scope

- Upload PDF or image files.
- Render source pages.
- Call `tibetan-ocr-core` for OCR.
- Call `tibetan-translation-services` for translation.
- Support page-by-page review, manual correction, and export.

## Local run

From the workspace root:

```bash
./tibetan-proofreading-app/start_services.sh
```

Frontend URL:

```text
http://127.0.0.1:8790/tibetan-proofreading-app/
```

## Architecture boundary

- This repo does not own OCR model execution.
- This repo does not own translation model execution.
- It is the orchestration and proofreading UI layer only.

### 千问复核的持久配置

在工作区根目录运行：

```bash
python3 tibetan-proofreading-app/configure_qwen_review.py
```

按提示输入百炼控制台提供的对应地域 Base URL 和 API key。key 使用隐藏输入，不要把 key 放进命令行或对话。助手默认写入本工作台的 `.qwen-review.env`（权限 `600`、已被 Git 忽略），然后仅重启 AI OCR 服务；以后 `start_services.sh` 自动加载这份环境配置。此操作只验证配置存在，不调用收费模型，也不保证 key 或模型额度有效。完成后刷新工作台，再按行使用千问复核。

已有配置时运行助手会复用它；替换密钥时可通过本机环境变量提供新值。若仅希望临时配置，使用 `--session-only`；它不会删除之前保存的配置。

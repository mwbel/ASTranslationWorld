# Gemini 4 Batch API 离线处理

本工具为现有实时识别页提供独立的离线批量路径，不改变 `gemini38-compare.html` 的同步调用和本地缓存。浏览器页面适用于 PDF 或页图藏文识别；下面的命令行 manifest 方式也可用于文字翻译等任务。

Google 的 Gemini Batch API 是异步任务。官方文档说明 Batch 定价为标准价格的 50%，目标处理时间可到 24 小时；任务在排队/运行超过 48 小时后会过期。Gemini 4 Argon 的 Batch 价格仅适用于可计费的付费 API 访问，不代表该账号一定已开通权限。创建任务前请先确认 AI Studio 结算账户和额度。

## 安装

```bash
python3 -m pip install -r tibetan-proofreading-app/requirements-gemini-batch.txt
```

命令行使用时，或需要明确指定可视化页面使用的计费项目时，在当前终端设置 API key。不要把 key 写入脚本、清单或 Git：

```bash
export GEMINI_API_KEY='你的 Gemini API key'
```

## 本地可视化界面

首次使用时安装 macOS 用户级自动启动服务。安装后服务会在登录时运行，关闭 Codex 或终端不会让页面失效：

```bash
python3 tibetan-proofreading-app/tools/install_gemini_batch_service.py install
```

之后可检查状态，或在手动停止后重新启动：

```bash
python3 tibetan-proofreading-app/tools/install_gemini_batch_service.py status
python3 tibetan-proofreading-app/tools/install_gemini_batch_service.py stop
python3 tibetan-proofreading-app/tools/install_gemini_batch_service.py install
```

如果只想临时运行，也可在终端启动独立服务（保持终端打开）：

```bash
python3 tibetan-proofreading-app/tools/gemini_batch_web.py
```

打开 [本地 Gemini Batch 页面](http://127.0.0.1:8795/gemini-batch.html)。页面流程：

1. 选择一个扫描 PDF，或者一次选择多张 PNG/JPEG/WebP/GIF 页图；填写任务名称、模型与提示词。
2. 点击“生成 Batch 请求”。PDF 会在本地浏览器逐页渲染，页图转换为 JPEG 后送往本机服务，生成可下载的请求 JSONL；这一步不会联系 Google。
3. 点击“提交到 Gemini（付费）”才会逐页上传请求并创建异步 Batch 任务，最多同时有 8 页在处理中。本地服务每 30 秒检查一次；只要本地服务仍在运行，关闭网页也会继续检查。
4. 每页成功后，原始响应与识别文字立即保存在任务目录。已完成的页可随时通过页面下载 JSONL 或按页排序的 TXT；后续页失败不会清除之前的结果。
5. 失败页可点击“重试失败页（付费）”，只重新提交失败页。若页面显示“需核对”，表示提交期间中断，不能确认远端是否已创建任务；先到 Google 核对，避免重复计费。

可视化页面的任务元数据、逐页 Batch 状态与缓存分别保存在 `workflow.json`、`batch_pages/page-0001/attempt-0001/` 和 `cache/page-0001.json`。恢复服务后会读取这些文件继续查询和导出。这里的缓存只保证**已经返回并成功下载到本机**的页；Google 仍在处理、或整页 Batch 失败时，尚未返回的结果无法从本地恢复。已缓存页导出时不会重新识别。

服务只监听本机地址。自动启动服务默认沿用现有 `ModelAggregatorService/.env` 密钥池中的第一个 key；临时启动时优先使用当前终端的 `GEMINI_API_KEY` 环境变量。页面只显示密钥来源，不显示密钥值；若不同 key 对应不同计费项目，使用临时启动方式并明确设置 `GEMINI_API_KEY`。任务页图、提示词、JSONL 和状态默认保存在 `~/Library/Application Support/TibetanGeminiBatch/`。自动启动配置位于 `~/Library/LaunchAgents/com.min369.tibetan-gemini-batch.plist`，日志位于 `~/Library/Logs/TibetanGeminiBatch/`。如状态栏提示缺少 key 或 SDK，请检查本地密钥配置与上面的安装步骤。

可视化页面当前处理图片识别；若要对 TXT 逐页翻译，请使用下方的 manifest 命令行方式。

## 图片目录：为 PDF 页图打包

先把扫描 PDF 渲染为 PNG/JPEG 页图。准备一个 UTF-8 提示词文件 `ocr-prompt.txt`，例如：

```text
逐行转录图片中的藏文，只返回原文，保留原有段落与标点，不要解释或翻译。
```

图片名按自然顺序排列，例如 `page-1.png`、`page-2.png`、`page-10.png`：

```bash
python3 tibetan-proofreading-app/tools/gemini_batch_ocr.py prepare \
  --images-dir '/path/to/page-images' \
  --prompt-file '/path/to/ocr-prompt.txt' \
  --output '/path/to/gemini-input.jsonl' \
  --temperature 0.1 \
  --max-output-tokens 16384
```

`prepare` 只在本地生成 JSONL，不上传数据、不创建模型任务。每页生成一条记录，JSONL 的结构符合 Gemini Batch API：

```json
{"key":"page-0001","request":{"contents":[{"role":"user","parts":[{"text":"逐行转录图片中的藏文……"},{"inlineData":{"mimeType":"image/png","data":"BASE64_IMAGE_DATA"}}]}],"generationConfig":{"temperature":0.1,"maxOutputTokens":16384}}}
```

## Manifest：图片识别或文本翻译

一行一个 UTF-8 JSON 对象。图片路径相对于 manifest 文件；`image` 可换成 `images` 数组。`prompt` 可在每条记录中指定，也可统一通过 `--prompt-file` 提供。`text` 用于将 OCR 文字送入翻译提示词。

```jsonl
{"key":"page-0001","image":"pages/0001.png","prompt":"逐行转录图片中的藏文，只返回原文。"}
{"key":"page-0002","text":"བོད་ཡིག་ཚིག་གཞུང་།","prompt":"将下面藏文翻译成中文，只返回译文。"}
```

生成时使用：

```bash
python3 tibetan-proofreading-app/tools/gemini_batch_ocr.py prepare \
  --manifest '/path/to/requests.jsonl' \
  --output '/path/to/gemini-input.jsonl'
```

工具会拒绝重复 key、空提示词、缺失图片和超过 20 MiB 的单条内嵌图片请求；超大图片请先缩小/压缩。Batch 输入 JSONL 最大 2 GiB。

## 提交、轮询和下载

**提交会把 JSONL 上传给 Google，并创建可能产生费用的异步任务。** 状态文件保存任务名和远端文件名，不包含 API key 或图片内容：

```bash
python3 tibetan-proofreading-app/tools/gemini_batch_ocr.py submit \
  --input '/path/to/gemini-input.jsonl' \
  --state '/path/to/gemini-batch-state.json' \
  --model gemini-4-argon \
  --display-name 'tibetan-book-1'
```

查看一次状态，或每 30 秒轮询直到任务结束：

```bash
python3 tibetan-proofreading-app/tools/gemini_batch_ocr.py status --state '/path/to/gemini-batch-state.json'
python3 tibetan-proofreading-app/tools/gemini_batch_ocr.py status --state '/path/to/gemini-batch-state.json' --wait --poll-seconds 30
```

命令行路径仍以整批 JSONL 为一个 Batch 任务，任务名持久保存在状态 JSON 中；关闭终端后仍可继续查询。成功后下载原始 JSONL，并可额外导出按页码排序的 TXT。需要逐页自动缓存与失败页重试时请使用上方本地可视化页面：

```bash
python3 tibetan-proofreading-app/tools/gemini_batch_ocr.py download \
  --state '/path/to/gemini-batch-state.json' \
  --output-jsonl '/path/to/gemini-output.jsonl' \
  --output-text '/path/to/gemini-output.txt'
```

TXT 中每个 `page-0001` key 会转换成“第 1 页”。逐条错误会保留在 JSONL/TXT 中，便于只重做失败页。

## 运行本地检查

```bash
python3 -m unittest tibetan-proofreading-app/tests/test_gemini_batch_ocr.py tibetan-proofreading-app/tests/test_gemini_batch_web.py
```

这些检查不会连接 Gemini API。要真正创建任务，需由用户运行上面的 `submit` 命令。

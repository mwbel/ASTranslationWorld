# Gemini 4 Batch API 离线处理

本工具为现有实时识别页提供独立的离线批量路径，不改变 `gemini38-compare.html` 的同步调用和本地缓存。适用于图片藏文识别，也可通过 manifest 对文字执行翻译等任务。

Google 的 Gemini Batch API 是异步任务。官方文档说明 Batch 定价为标准价格的 50%，目标处理时间可到 24 小时；任务在排队/运行超过 48 小时后会过期。Gemini 4 Argon 的 Batch 价格仅适用于可计费的付费 API 访问，不代表该账号一定已开通权限。创建任务前请先确认 AI Studio 结算账户和额度。

## 安装

```bash
python3 -m pip install -r tibetan-proofreading-app/requirements-gemini-batch.txt
```

在当前终端设置 API key。不要把 key 写入脚本、清单或 Git：

```bash
export GEMINI_API_KEY='你的 Gemini API key'
```

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

任务名持久保存在状态 JSON 中；关闭终端后仍可继续查询。成功后下载原始 JSONL，并可额外导出按页码排序的 TXT：

```bash
python3 tibetan-proofreading-app/tools/gemini_batch_ocr.py download \
  --state '/path/to/gemini-batch-state.json' \
  --output-jsonl '/path/to/gemini-output.jsonl' \
  --output-text '/path/to/gemini-output.txt'
```

TXT 中每个 `page-0001` key 会转换成“第 1 页”。逐条错误会保留在 JSONL/TXT 中，便于只重做失败页。

## 运行本地检查

```bash
python3 -m unittest tibetan-proofreading-app/tests/test_gemini_batch_ocr.py
```

这些检查不会连接 Gemini API。要真正创建任务，需由用户运行上面的 `submit` 命令。

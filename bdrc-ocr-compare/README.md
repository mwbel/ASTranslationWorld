# 藏文典籍 OCR 对照工作台

这是一个独立静态前端页面，用于逐页对照藏文 PDF 原文和 BDRC OCR 识别结果。

## 启动

在项目根目录运行：

```bash
python3 -m http.server 8787
```

然后打开：

```text
http://127.0.0.1:8787/bdrc-ocr-compare/
```

## OCR 接口约定

页面会把当前页渲染成 PNG，并以 `multipart/form-data` 提交到顶部配置的接口地址，默认：

```text
POST http://127.0.0.1:18090/ocr
```

本目录提供了一个最小本地 wrapper，可以直接启动：

```bash
python3 bdrc-ocr-compare/bdrc_ocr_server.py
```

健康检查：

```bash
curl http://127.0.0.1:18090/health
```

默认配置：

- BDRC 源码目录：`tmp/tibetan-ocr-app`
- BDRC 模型目录：`/Applications/BDRC Tibetan OCR.app/Contents/MacOS/OCRModels`
- 默认模型：`Modern`
- 默认行检测：`line`

可以通过环境变量调整：

```bash
BDRC_MODEL=Woodblock BDRC_LINE_MODE=layout python3 bdrc-ocr-compare/bdrc_ocr_server.py
```

表单字段：

- `file`: 当前页 PNG 图片
- `engine`: `bdrc`
- `lang`: `bo`
- `page`: 当前页码
- `source_name`: 上传文件名

接口可返回纯文本，也可返回 JSON。JSON 中以下字段会被自动识别为 OCR 文本：

- `text`
- `ocr_text`
- `ocrText`
- `result_text`
- `output`
- `result.text`
- `lines[].text`

## 当前边界

BDRC 官方本地客户端是 GUI 应用，不是 HTTP 服务。这里的 `bdrc_ocr_server.py` 是本地 wrapper，复用 BDRC 源码和你已安装客户端里的模型。识别质量取决于模型选择、行检测模式、页面裁切和图片清晰度；建议对同一批样本试 `Modern`、`Woodblock`、`Woodblock-Stacks`。

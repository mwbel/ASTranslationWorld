# 藏文典籍 OCR 对照工作台

这是一个独立静态前端页面，用于逐页对照藏文 PDF 原文、BDRC OCR 识别结果和藏译汉结果。

## 启动

在项目根目录运行：

```bash
python3 -m http.server 8787
```

然后打开：

```text
http://127.0.0.1:8787/bdrc-ocr-compare/
```

页面依赖已放在 `vendor/`，包括 PDF.js、PDF worker 和 lucide 图标库；启动后不需要再从 CDN 加载前端依赖。

## 文件状态标签

页面会按文件维护本地暂存状态。再次载入同名、同大小、同类型的文件时，会从浏览器 `localStorage` 恢复已保存的 OCR 和译文。

文件级 OCR 标签按已识别页数自动切换：

- 0 页已识别：`ocr 识别未开始`
- 部分页已识别：`ocr 识别进行中`
- 全部页已识别：`ocr 识别已完成`

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

## 藏译汉接口约定

页面第三栏默认调用：

```text
POST http://127.0.0.1:18091/translate
```

请求体为 JSON：

```json
{
  "text": "OCR 得到的藏文",
  "source_lang": "bo",
  "target_lang": "zh",
  "src_lang": "bod_Tibt",
  "tgt_lang": "zho_Hans",
  "page": 1,
  "source_name": "source.pdf"
}
```

接口可返回纯文本，也可返回 JSON。JSON 中以下字段会被自动识别为译文：

- `translation`
- `translated_text`
- `translatedText`
- `target_text`
- `targetText`
- `zh`
- `text`
- `output`
- `result.translation`
- `translations[].translation`

## 本地 NLLB 藏译汉服务

本目录提供了一个最小 NLLB wrapper，默认模型为 `facebook/nllb-200-distilled-600M`，语言代码为 `bod_Tibt -> zho_Hans`。

安装依赖：

```bash
python3 -m pip install -r bdrc-ocr-compare/requirements-translate.txt
```

启动：

```bash
python3 bdrc-ocr-compare/nllb_translate_server.py
```

健康检查：

```bash
curl http://127.0.0.1:18091/health
```

测试翻译：

```bash
curl -X POST http://127.0.0.1:18091/translate \
  -H "Content-Type: application/json" \
  -d '{"text":"བོད་ཡིག"}'
```

可通过环境变量调整：

```bash
NLLB_MODEL=facebook/nllb-200-1.3B \
NLLB_DEVICE=mps \
NLLB_BATCH_SIZE=2 \
python3 bdrc-ocr-compare/nllb_translate_server.py
```

NLLB wrapper 会在启动后后台下载和加载模型。`GET /health` 会返回 `status`：

- `loading`: 模型正在下载或加载，前端会提示稍后再试，不会发起真正翻译请求。
- `ready`: 模型可用，可以点击“翻译当前页”。
- `error`: 模型加载失败，返回 `error` 字段。

长页 OCR 文本会按行分段翻译，减少模型输入被截断的风险。

## 开源藏译汉方案取舍

- NLLB-200：最适合作为本项目第一版自托管基线；Transformers 直接可用，支持 `bod_Tibt` 和 `zho_Hans`，部署成本中等，但许可证偏研究/非商业，正式商用前要复核许可。
- Hunyuan-MT：腾讯开源多语言翻译模型，公开说明支持 Tibetan；模型能力和体量更适合服务器部署，适合作为后续质量对照或高质量后端。
- nllb-serve / nllb-api：开源 NLLB HTTP 包装层，适合快速部署已有模型服务；但接口字段和维护活跃度需要实测。
- EasyNMT：Python 包装层更轻，适合命令行或服务端脚本快速调用 OPUS-MT/M2M100/mBART 等模型；藏文到中文质量和模型覆盖需要按样本验证。

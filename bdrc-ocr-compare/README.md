# 藏文典籍 OCR 对照工作台

这是一个独立静态前端页面，用于逐页对照藏文 PDF 原文、BDRC OCR 识别结果和藏译汉结果。

BDRC 本地接口会同时返回每一行的识别文字和其在原页中的归一化坐标。OCR 栏默认采用逐行校对视图，只显示可直接修改的藏文文本；点击或聚焦某一行时，原文栏会自动滚动并高亮对应位置。也可以切换到纯文本视图。使用不提供行坐标的外部 OCR 接口时，页面仍可使用纯文本模式。

## 一键启动前后端

首次使用翻译服务时，先安装 NLLB 依赖：

```bash
python3 -m pip install -r bdrc-ocr-compare/requirements-translate.txt
```

随后在项目根目录运行：

```bash
./bdrc-ocr-compare/start_services.sh
```

脚本会启动并检查：

- 前端：`http://127.0.0.1:8790/bdrc-ocr-compare/`
- BDRC OCR：`http://127.0.0.1:18090/health`
- 藏译汉：`http://127.0.0.1:18091/health`

启动日志和 PID 默认保存在系统临时目录
`$TMPDIR/bdrc-ocr-compare-services-$UID/`。再次执行启动脚本不会重复启动已经运行的服务。

停止三个服务：

```bash
./bdrc-ocr-compare/stop_services.sh
```

不希望启动后自动打开浏览器时：

```bash
OPEN_BROWSER=0 ./bdrc-ocr-compare/start_services.sh
```

## 仅启动前端

在项目根目录运行：

```bash
python3 -m http.server 8790 --bind 127.0.0.1
```

然后打开：

```text
http://127.0.0.1:8790/bdrc-ocr-compare/
```

页面依赖已放在 `vendor/`，包括 PDF.js、PDF worker 和 lucide 图标库；启动后不需要再从 CDN 加载前端依赖。

为降低首次打开大 PDF 的等待时间，页面载入 PDF 后只优先渲染当前页；左侧缩略图列表会在浏览器空闲时分批创建，缩略图先显示页码占位，并在滚动到可见区域时再逐步渲染。

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

本地 wrapper 还会返回 `lines[].bbox`，其中包含归一化的 `x`、`y`、`width`、`height`，用于原文行同步定位。

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

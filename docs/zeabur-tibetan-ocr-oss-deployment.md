# 藏文 OCR 对照与翻译：Zeabur + 阿里云 OSS 部署

当前线上地址：`https://tibetan-proofreading.zeabur.app/tibetan-proofreading-app/`

## 部署边界

- 同一仓库同时保留本地与 Zeabur 两种运行方式。
- Zeabur 运行前端、OSS 持久化 API、AI Vision OCR 和藏译汉适配器。
- 一个私有 OSS Bucket 保存全部待校对书籍、状态和导出；按 `tibetan-proofreading/books/<book_id>/` 隔离。
- 本地 BDRC 依赖 macOS 应用模型，不能直接复制进 Linux 容器。Zeabur 通过 `BDRC_OCR_UPSTREAM_URL` 调用独立部署的 BDRC 服务；未配置时 `/health` 会明确显示 `bdrc.configured=false`，不会伪装为可用。
- 本地 `127.0.0.1` 工作流不变，仍使用本地端口与 localStorage。

## OSS Bucket

在阿里云 OSS 控制台新建一个 Bucket，建议：

- 名称：使用全局唯一名称，例如 `manju-tibetan-proofreading-prod`（如被占用，在末尾增加账号或地区缩写）。
- 地域：选择离 Zeabur 部署区域和主要使用者最近的中国大陆地域。
- 存储类型：标准存储。
- 读写权限：私有。
- 版本控制：建议开启，避免误覆盖校对状态。
- 跨域：不需要开放浏览器直传；浏览器只访问 Zeabur，同 OSS 的通信由服务端完成。

创建一个仅限该 Bucket 的 RAM 子用户/角色。最小权限应只允许列举该 Bucket，并读写、删除 `tibetan-proofreading/*` 对象。不要使用主账号 AccessKey，不要把 AccessKey 写进仓库。

当前机器复用的参考项目 RAM 凭证不具备 `oss:PutBucket`，无法新建 Bucket。因此本次实际部署复用参考项目的私有 Bucket，并用独立 `tibetan-proofreading/` 前缀隔离。若以后改为独立 Bucket，应由主账号创建后，再把该 Bucket 前缀权限授予现有 RAM 凭证。

## Zeabur 环境变量

在 Zeabur 服务的 Variables 中配置：

```env
PORT=8080
OSS_ENDPOINT=https://oss-cn-<region>.aliyuncs.com
OSS_BUCKET=<新建的 bucket 名称>
OSS_ACCESS_KEY_ID=<RAM 子用户 AccessKey ID>
OSS_ACCESS_KEY_SECRET=<RAM 子用户 AccessKey Secret>
OSS_PREFIX=tibetan-proofreading
MAX_UPLOAD_BYTES=209715200

# 真正 BDRC 初稿服务；没有独立 Linux/GPU 服务时先留空
BDRC_OCR_UPSTREAM_URL=https://<bdrc-service>/ocr

# AI Vision OCR：当前线上使用 Gemini OpenAI-compatible 入口
AI_VISION_PROVIDER=openai-compatible
AI_VISION_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
AI_VISION_API_KEY=<Gemini API key>
AI_VISION_MODEL=gemini-2.5-flash
AI_VISION_TIMEOUT=180

# 藏译汉：当前线上使用相同 Gemini 入口
TRANSLATE_PROVIDER=openai_compatible
OPENAI_TRANSLATE_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
OPENAI_TRANSLATE_API_KEY=<Gemini API key>
OPENAI_TRANSLATE_MODEL=gemini-2.5-flash
MODEL_AGGREGATOR_TIMEOUT_SECONDS=180
```

如果不使用模型聚合器，AI OCR 可改用 OpenAI-compatible：

```env
AI_VISION_PROVIDER=openai-compatible
AI_VISION_BASE_URL=https://<provider>/v1
AI_VISION_API_KEY=<key>
AI_VISION_MODEL=<vision-model-id>
```

## Zeabur 操作

1. 在 Zeabur 项目中新增 Git Service，选择 GitHub 仓库 `mwbel/ASTranslationWorld` 和部署分支。
2. 仓库根目录的 `zbpack.json` 会指定 `Dockerfile.zeabur`。
3. 填入上述 Variables，生成域名并部署。
4. 检查 `https://<domain>/health`，必须满足 `oss.configured=true`；需要 BDRC 对照时还必须满足 `bdrc.configured=true`。
5. 打开 `https://<domain>/tibetan-proofreading-app/`。

## 数据布局与验证

每本书写入：

```text
tibetan-proofreading/books/<book_id>/source/<原文件名>
tibetan-proofreading/books/<book_id>/metadata.json
tibetan-proofreading/books/<book_id>/state.json
tibetan-proofreading/books/<book_id>/exports/<时间>-<类型>.md
```

冒烟测试：上传 TXT/Markdown 确认直读；上传图片或扫描 PDF 确认生成 `source/` 对象；运行 OCR 和翻译后确认 `state.json` 更新；刷新页面前记录 URL 中的 `book_id`；导出后确认 `exports/` 生成对象。当前版本已完成状态写入接口，但跨设备“书库列表/仅凭 book_id 重新下载源书并恢复工作区”尚未实现，不能把它描述为完整多人协作系统。

## 2026-07-13 线上验证结果

- `/health`：通过，OSS、AI OCR、藏译中配置正常。
- 工作台静态页面：HTTP 200。
- OSS：建书、`state.json` 更新/读取、Markdown 导出回写通过。
- 藏译中：真实藏文请求成功，Gemini 2.5 Flash 返回中文译文。
- AI Vision OCR：真实图片请求成功。
- BDRC：尚未配置 `BDRC_OCR_UPSTREAM_URL`。智能模式会明确提示后回退到 AI Vision；尚不能称为完整 BDRC + LLM 双结果对照。

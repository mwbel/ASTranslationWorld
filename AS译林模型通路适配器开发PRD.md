# AS译林模型通路适配器开发 PRD

版本：v0.1  
日期：2026-06-21  
状态：草案  
目标：在不获取 AS译林前后端源码的前提下，通过兼容网关/适配器替换其现有大模型聚合平台调用链路，使系统能够调用用户自有本地大模型或自有 API Key。

## 1. 背景

AS译林当前以 Docker 离线部署包形式运行，部署包包含前端静态产物、后端编译产物、Postgres、Redis、Nginx 与 Docker Compose 配置，但不包含前后端原始源码。

线上检查已确认：

- 应用入口、登录注册、项目/章节/页面/段落、导入文本、阅读台、工作台等主链路可运行。
- 系统提供 BYO key 配置入口，前端字段包括 `gateway_endpoint`、`reseller_code`、`username`、`password`。
- 未配置 BYO 账号时，模型相关接口返回：`请先在账号菜单 -> BYO key 配置并登录你的积微账号；AS译林不再共享管理员 LLM 通路。`
- 因没有源码，不能直接改后端模型调用层；更可行的方式是在 AS译林和实际模型服务之间增加一个“兼容原聚合平台协议”的适配器服务。

## 2. 产品目标

建设一个可部署在校园网服务器或同网段机器上的模型通路适配器，使 AS译林后端把它当作原聚合平台调用，但适配器实际转发到用户控制的模型服务。

支持的目标模型服务包括：

- OpenAI-compatible API，例如本地 vLLM、One API、New API、LiteLLM、FastChat、xinference 等。
- Ollama 本地模型。
- LM Studio 本地 API。
- 云端 API Key 服务，例如 OpenAI、OpenRouter、硅基流动、DeepSeek、通义千问、智谱等，前提是可通过适配器统一封装。
- 后续可扩展到 OCR/Vision 模型、Embedding、Rerank 等能力。

## 3. 非目标

本项目不做以下事项：

- 不复刻完整 AS译林系统。
- 不反编译或修改 AS译林后端二进制。
- 不绕过 AS译林已有登录、权限、项目数据结构。
- 不直接暴露 Postgres、Redis、AS译林后端服务到公网。
- 不承诺第一版支持所有模型能力，优先保证文本翻译和模型列表。

## 4. 成功标准

第一阶段成功标准：

- AS译林 BYO key 页面可以保存适配器地址和测试账号。
- 点击“测试：拉取我的模型”或“重新拉模型”时，AS译林能够从适配器拿到可用模型列表。
- 在 AS译林工作台点击段落翻译时，请求能够通过适配器转发到用户指定模型，并返回译文。
- 调用失败时，AS译林前端能显示可理解的错误信息。
- 适配器日志能记录请求链路、模型、耗时、错误原因，但不泄露用户密码和完整密钥。

第二阶段成功标准：

- 支持流式翻译。
- 支持 OCR/Vision 模型调用。
- 支持用量统计：调用次数、输入/输出 token、模型维度聚合。
- 支持多用户凭证隔离。
- 支持配置多后端 provider 并按模型路由。

## 5. 用户角色

### 5.1 系统管理员

负责部署适配器、配置可用 provider、配置模型别名、维护日志和密钥。

### 5.2 AS译林普通用户

在 AS译林的 BYO key 页面填写适配器地址、账号和密码，然后使用自己的模型额度进行翻译、OCR、改写。

### 5.3 开发/运维人员

负责协议探测、接口兼容、故障排查、模型接入和版本升级。

## 6. 总体方案

采用“兼容网关”方案：

```text
AS译林前端
  -> AS译林后端
    -> 适配器服务（伪装成原聚合平台）
      -> 本地模型 / OpenAI-compatible API / Ollama / 云 API
```

用户在 AS译林 BYO key 页面中填写：

- `gateway_endpoint`：适配器服务地址，例如 `http://host.docker.internal:18080` 或 `http://校园服务器内网IP:18080`
- `reseller_code`：适配器约定的租户/渠道码，可选
- `username`：适配器账号
- `password`：适配器密码或一次性接入密钥

AS译林后端继续按照原聚合平台协议访问 `gateway_endpoint`。适配器负责兼容这些请求，并映射到真实模型 provider。

## 7. 核心挑战

当前没有 AS译林后端源码，也没有原聚合平台协议文档，因此第一步不是直接开发完整适配器，而是做协议探测。

协议探测目标：

- AS译林保存 BYO 凭证时会请求哪些路径。
- AS译林登录聚合平台时的请求方法、headers、body 格式。
- 拉取模型列表的接口路径和返回格式。
- 翻译/生成请求的接口路径、body 格式、是否流式。
- OCR/Vision 请求的图片传输方式。
- 错误响应格式。
- token 刷新机制和过期时间字段。

## 8. 协议探测方案

### 8.1 搭建探测服务器

先搭建一个只记录请求的 HTTP 服务，将 AS译林 BYO key 中的 `gateway_endpoint` 指向该服务。

探测服务器要求：

- 监听 HTTP 端口，例如 `18080`。
- 记录 method、path、query、headers、body。
- 对所有请求返回可控响应。
- 支持 JSON、multipart、stream、普通文本。
- 对敏感字段做脱敏存储。

### 8.2 探测操作路径

在 AS译林页面依次执行：

1. 保存 BYO key 并登录。
2. 点击“测试：拉取我的模型”。
3. 点击“重新拉模型”。
4. 进入 Demo 工作台，点击某段“开始翻译”。
5. 尝试生成逐词直译。
6. 如需要 OCR，上传一张小图片并触发 OCR。

### 8.3 探测输出物

探测完成后产出：

- `protocol-observations.md`：人工可读协议记录。
- `captured-requests/*.json`：脱敏后的请求样本。
- `response-contracts.md`：AS译林可接受的成功/失败响应格式。
- `adapter-api-map.md`：原协议接口到适配器内部 provider 的映射。

## 9. 功能需求

### 9.1 账号登录兼容

适配器需要实现 AS译林所期望的账号登录接口。

初步假设：

- 输入：`username`、`password`、可能包含 `reseller_code`。
- 输出：访问 token、过期时间、用户信息或授权状态。

具体路径和字段以协议探测结果为准。

验收：

- AS译林 BYO 页面显示“已登录”或等价成功状态。
- AS译林能够保存配置，并在后续调用中自动带上 token。

### 9.2 模型列表

适配器需要返回 AS译林可识别的模型列表。

模型信息至少应包含：

- 模型 ID。
- 模型名称。
- 能力类型：文本、视觉、推理、快速、低价等。
- 上下文长度。
- 是否支持流式。
- 是否支持 vision。
- 可选价格或用量字段。

适配器内部可将本地模型映射为 AS译林模型类别，例如：

| AS译林模型类别 | 建议映射 |
| --- | --- |
| 主译之笔 | 高质量文本模型 |
| 急就之笔 | 快速低延迟模型 |
| 深思之笔 | 推理模型 |
| 汉言本笔 | 中文优化模型 |
| 省俭批笔 | 低成本批量模型 |
| 目验之眼 | Vision/OCR 模型 |

验收：

- AS译林“拉取我的模型”能显示非空模型列表。
- 角色管理或模型配置中可选择适配器返回的模型。

### 9.3 文本生成/翻译

适配器需要将 AS译林的文本生成请求转为目标 provider 请求。

最小能力：

- 支持非流式 chat/completion。
- 支持 system prompt、user prompt。
- 支持 temperature、max_tokens、model。
- 支持返回纯文本译文。

增强能力：

- 支持流式 SSE。
- 支持多轮 messages。
- 支持 JSON mode 或结构化输出。
- 支持超时、重试、fallback 模型。

验收：

- 在 AS译林工作台中点击段落翻译，能得到译文提案。
- 后端错误时前端显示错误，不导致页面崩溃。

### 9.4 OCR/Vision

如果 AS译林触发 OCR 时也走同一 BYO 聚合通路，适配器第二阶段需要支持视觉模型。

能力要求：

- 接收图片 URL、base64 或 multipart 图片。
- 转发到支持视觉的 provider。
- 返回 AS译林期望的 OCR 文本或结构化结果。

验收：

- 上传小图后能完成 OCR。
- OCR 失败时能返回明确错误。

### 9.5 用量统计

适配器应记录每次调用：

- 用户。
- 模型。
- provider。
- 请求类型：translation、ocr、chat、literal、review 等。
- 输入 token。
- 输出 token。
- 耗时。
- 成功/失败。
- 错误码。

验收：

- 管理员可查看最近调用日志。
- 可导出 CSV/JSON。

### 9.6 管理配置

适配器需要支持配置文件或环境变量。

建议配置项：

```yaml
server:
  host: 0.0.0.0
  port: 18080

auth:
  users:
    - username: wumin
      password_hash: "<bcrypt>"
      allowed_models: ["local-qwen", "deepseek-chat"]

providers:
  - id: local-openai
    type: openai_compatible
    base_url: http://127.0.0.1:8000/v1
    api_key: local-dev-key
  - id: ollama
    type: ollama
    base_url: http://127.0.0.1:11434

models:
  - id: local-qwen
    display_name: Qwen Local
    provider: local-openai
    upstream_model: Qwen3-32B
    category: quality_translation
    supports_stream: true
    supports_vision: false
  - id: local-vision
    display_name: Local Vision OCR
    provider: local-openai
    upstream_model: Qwen2.5-VL
    category: multimodal_vision
    supports_stream: false
    supports_vision: true
```

## 10. 非功能需求

### 10.1 安全

- 不在日志中记录明文密码、API Key、Authorization header。
- 用户密码使用 bcrypt/argon2 存储。
- 支持内网部署，默认不暴露公网。
- 支持 HTTPS 反向代理。
- 支持 IP allowlist。
- 支持请求体大小限制，避免大文件压垮服务。
- 支持调用超时和并发限制。

### 10.2 稳定性

- 单次模型调用超时可配置，默认 120 秒。
- provider 不可用时返回明确错误。
- 支持健康检查接口。
- 支持 Docker Compose 部署。
- 日志可滚动，避免磁盘占满。

### 10.3 可观测性

- `/health`：服务健康。
- `/metrics`：可选 Prometheus 指标。
- 请求 ID 贯穿日志。
- 错误日志包含 provider、model、状态码、耗时。

### 10.4 性能

- 第一版目标并发：5-20 个模型请求。
- 流式请求不应阻塞其他普通请求。
- 大文件 OCR 请求需要限制最大图片大小。

## 11. 技术选型建议

推荐两种实现路线。

### 11.1 Python FastAPI

优点：

- 开发快。
- 适合协议探测和快速适配。
- 易于接入 OpenAI、Ollama、httpx、SSE。

适合第一版。

### 11.2 Node.js/TypeScript

优点：

- 前端/后端团队易维护。
- 对 SSE、代理、JSON schema 友好。

适合长期产品化。

建议：第一版使用 Python FastAPI，协议稳定后再决定是否重写。

## 12. 部署方案

### 12.1 与 AS译林同机部署

```text
AS译林 Docker Compose
  sutra-web: 80/8080
  sutra-server: 5555 internal
  postgres
  redis

Adapter Docker Compose
  adapter: 18080
  optional: local model service
```

AS译林 BYO key 填写：

```text
gateway_endpoint = http://宿主机IP:18080
username = 适配器用户名
password = 适配器密码
```

注意：如果 AS译林后端在 Docker 容器内访问宿主机，`127.0.0.1` 指的是容器自身，不是宿主机。应使用宿主机内网 IP，或 Docker 网络别名。

### 12.2 独立机器部署

适配器可部署在另一台服务器，只开放给校园网或 AS译林服务器访问。

## 13. 里程碑

### M0：协议探测

周期：0.5-1 天

交付：

- 请求样本。
- 接口路径列表。
- 初步响应格式。
- 是否支持只做适配器的结论。

### M1：最小可用适配器

周期：1-3 天，取决于协议复杂度。

交付：

- 登录兼容。
- 拉模型兼容。
- 非流式文本生成兼容。
- OpenAI-compatible provider。
- Dockerfile 与 docker-compose。
- README。

### M2：生产化增强

周期：3-7 天。

交付：

- 流式输出。
- Ollama provider。
- 多用户隔离。
- 用量日志。
- 并发/超时/重试。
- 管理端简易日志查询。

### M3：OCR/Vision 与高级能力

周期：视协议和模型能力而定。

交付：

- Vision/OCR 请求兼容。
- 图片输入适配。
- OCR 输出结构化。
- 多 provider fallback。

## 14. 验收测试用例

### 14.1 BYO 登录

步骤：

1. 在 AS译林中填写适配器地址、用户名、密码。
2. 点击保存并登录。

预期：

- 前端提示登录成功。
- 适配器日志出现登录请求。
- AS译林后续请求携带适配器返回的 token 或等价凭证。

### 14.2 拉取模型

步骤：

1. 点击“测试：拉取我的模型”或“重新拉模型”。

预期：

- 前端显示模型数量。
- 模型配置中可以选择模型。

### 14.3 翻译段落

步骤：

1. 打开 Demo 或新建项目。
2. 选择一个段落。
3. 选择模型并触发翻译。

预期：

- 适配器收到生成请求。
- 真实模型返回译文。
- AS译林中出现译文提案。

### 14.4 错误处理

步骤：

1. 将 provider API Key 改错。
2. 触发翻译。

预期：

- AS译林显示明确错误。
- 适配器日志记录 provider 错误。
- 服务不崩溃。

### 14.5 并发与超时

步骤：

1. 同时触发多个段落翻译。

预期：

- 并发请求被限制在配置范围内。
- 超时请求返回明确错误。
- 其他请求不受单个失败影响。

## 15. 风险与应对

| 风险 | 影响 | 应对 |
| --- | --- | --- |
| 原聚合平台协议未知 | 无法直接开发 | 先做协议探测服务器 |
| 登录流程复杂，有 token 刷新 | BYO 无法保持在线 | 模拟 token 生命周期，按探测结果实现刷新 |
| AS译林请求使用 HTTPS 校验证书 | 内网 HTTP 不可用 | 使用自签/正式证书或反向代理 |
| 流式协议不兼容 | 前端无法实时显示 | 第一版先非流式，第二版补 SSE |
| OCR 请求格式复杂 | OCR 适配延期 | M1 只做文本翻译，M3 单独处理 OCR |
| 本地模型质量不足 | 翻译效果差 | 支持多模型路由和云 API fallback |
| 适配器暴露公网 | 凭证泄露风险 | 默认仅内网访问，增加 IP allowlist |

## 16. 开放问题

以下问题需要在 M0 协议探测后确认：

- 原聚合平台登录接口路径是什么？
- 登录响应是否必须包含特定字段名？
- 模型列表返回格式是什么？
- 翻译请求是 OpenAI-compatible，还是自定义协议？
- 是否所有 LLM 调用都走 `gateway_endpoint`？
- OCR/Vision 是否走同一协议？
- AS译林是否要求 token 过期时间？
- AS译林是否依赖模型 category、price、capability 等字段？
- 错误响应是否需要 JSON，还是纯文本即可？

## 17. 推荐第一步执行计划

1. 写一个 `probe-server`，接收并记录所有请求。
2. 将 AS译林 BYO key 的 `gateway_endpoint` 指向 `probe-server`。
3. 在 AS译林页面执行保存登录、拉模型、翻译、OCR 等操作。
4. 根据捕获请求补齐协议文档。
5. 实现 M1 适配器：登录、模型列表、文本生成。
6. 接入一个 OpenAI-compatible 本地模型服务验证端到端翻译。

## 18. 一句话结论

在没有 AS译林源码的情况下，完整改造后端不现实；但通过“兼容原聚合平台协议的模型通路适配器”，替换为用户自己的本地大模型或 API Key 是可行且优先推荐的方案。

# AS译林模型通路适配器开发任务执行清单

版本：v0.1  
日期：2026-06-21  
关联文档：[AS译林模型通路适配器开发PRD.md](./AS译林模型通路适配器开发PRD.md)

## 0. 准备阶段

- [ ] 确认 AS译林线上地址、管理员账号、测试普通账号可用。
- [ ] 确认可以进入 BYO key 页面并填写 `gateway_endpoint`、`reseller_code`、`username`、`password`。
- [ ] 确认校园服务器或本机可部署一个临时 HTTP 服务作为探测网关。
- [ ] 确认 AS译林后端容器能访问探测网关地址。
- [ ] 准备一个不含真实密钥的测试账号和测试密码。
- [ ] 准备一个最小测试项目或 Demo 段落用于触发翻译。

## 1. 协议探测 M0

### 1.1 探测服务器

- [x] 创建 `probe-server` 项目目录。
- [x] 实现接收所有路径的 HTTP handler。
- [x] 记录请求 method、path、query、headers、body。
- [x] 对 `Authorization`、`password`、`api_key`、`token` 等字段脱敏。
- [x] 支持 JSON 请求体记录。
- [x] 支持 multipart/form-data 请求体摘要记录。
- [x] 支持 SSE/stream 请求的基础记录。
- [x] 增加 `/health` 健康检查。
- [x] 提供 Dockerfile。
- [x] 提供 docker-compose.yml。

### 1.2 探测操作

- [ ] 将 AS译林 BYO key 的 `gateway_endpoint` 指向探测服务器。
- [ ] 点击“保存并登录”，记录登录请求。
- [ ] 点击“测试：拉取我的模型”，记录模型列表请求。
- [ ] 点击“重新拉模型”，确认是否复用同一接口。
- [ ] 在工作台触发一次段落翻译，记录生成请求。
- [ ] 触发一次逐词直译或 literal generation，记录请求。
- [ ] 如需要 OCR，上传小图片并触发 OCR，记录 Vision 请求。
- [ ] 记录 AS译林对失败响应的前端表现。

### 1.3 探测交付物

- [ ] 输出 `protocol-observations.md`。
- [ ] 输出 `captured-requests/` 脱敏样本。
- [ ] 输出 `response-contracts.md`。
- [ ] 输出 `adapter-api-map.md`。
- [ ] 判断第一版是否只需登录、拉模型、文本生成三个接口。

## 2. 最小适配器 M1

### 2.1 项目骨架

- [x] 创建 `adapter-server` 项目目录。
- [x] 选择技术栈，建议 Python FastAPI。
- [x] 增加配置文件 `config.yaml`。
- [x] 增加 `.env.example`。
- [x] 增加 Dockerfile。
- [x] 增加 docker-compose.yml。
- [x] 增加 README 部署说明。
- [x] 增加基础日志配置。

### 2.2 认证兼容

- [ ] 按探测结果实现登录接口。
- [x] 支持 `username`、`password`、`reseller_code` 校验。
- [x] 返回 AS译林可接受的 token 或登录成功结构。
- [x] 支持 token 过期时间字段。
- [x] 支持无效密码错误响应。
- [x] 密码使用 hash，不在配置中保存明文生产密码。

### 2.3 模型列表兼容

- [ ] 按探测结果实现模型列表接口。
- [x] 支持从 `config.yaml` 读取模型清单。
- [x] 返回模型 ID、显示名、类别、能力字段。
- [x] 映射 AS译林模型类别：主译之笔、急就之笔、深思之笔、汉言本笔、省俭批笔、目验之眼。
- [ ] 支持空模型列表错误提示。
- [ ] 在 AS译林中验证“拉取我的模型”成功。

### 2.4 OpenAI-compatible Provider

- [x] 实现 OpenAI-compatible chat completions 客户端。
- [x] 支持 `base_url`。
- [x] 支持 `api_key`。
- [x] 支持 `model` 到 `upstream_model` 映射。
- [x] 支持 `temperature`。
- [x] 支持 `max_tokens`。
- [x] 支持超时配置。
- [x] 支持错误透传和错误归一化。

### 2.5 文本生成兼容

- [ ] 按探测结果实现 AS译林文本生成接口。
- [x] 将 AS译林请求转换为 provider messages。
- [x] 将 provider 响应转换为 AS译林期望格式。
- [x] 支持非流式返回。
- [x] 记录输入输出 token，如果 provider 返回 usage。
- [ ] 在 AS译林 Demo 段落中验证能生成译文。

## 3. 生产增强 M2

### 3.1 流式输出

- [ ] 判断 AS译林是否使用 SSE 或 fetch stream。
- [ ] 实现流式请求解析。
- [ ] 实现 OpenAI-compatible stream 转发。
- [ ] 处理中途断连。
- [ ] 处理 provider stream 错误。
- [ ] 在前端验证译文实时出现。

### 3.2 多 Provider

- [ ] 增加 Ollama provider。
- [ ] 增加 LM Studio provider。
- [ ] 支持多个 OpenAI-compatible provider。
- [ ] 支持按模型路由到不同 provider。
- [ ] 支持 fallback provider。
- [ ] 支持禁用某个模型。

### 3.3 用量与日志

- [ ] 记录每次调用的 request_id。
- [ ] 记录用户、模型、provider、用途、耗时。
- [ ] 记录调用成功/失败。
- [ ] 记录 token usage。
- [ ] 提供最近调用日志查询接口。
- [ ] 提供 CSV/JSON 导出。
- [ ] 设置日志滚动，防止磁盘占满。

### 3.4 并发与限流

- [ ] 增加全局并发限制。
- [ ] 增加单用户并发限制。
- [ ] 增加单模型并发限制。
- [ ] 增加请求体大小限制。
- [ ] 增加调用超时。
- [ ] 增加简单重试策略。

## 4. OCR/Vision M3

- [ ] 根据探测结果确认 OCR 是否走同一 BYO 通路。
- [ ] 确认图片输入格式：URL、base64、multipart 或文件路径。
- [ ] 实现 Vision 请求转换。
- [ ] 接入一个支持 Vision 的 provider。
- [ ] 将 Vision/OCR 输出转换为 AS译林期望格式。
- [ ] 在 AS译林中上传小图并完成 OCR。
- [ ] 验证 OCR 失败时错误信息可读。

## 5. 安全部署

- [ ] 默认只监听内网地址或 Docker 网络。
- [ ] 如需公网访问，使用 HTTPS 反向代理。
- [ ] 增加 IP allowlist。
- [ ] 不记录完整密钥、密码、token。
- [ ] 管理日志接口需要认证。
- [ ] 配置文件权限限制为仅部署用户可读。
- [ ] 生产环境关闭 debug 日志。
- [ ] 备份适配器配置文件。

## 6. 端到端验收

- [ ] AS译林 BYO key 保存适配器凭证成功。
- [ ] AS译林可拉取模型列表。
- [ ] AS译林角色管理中可选择适配器模型。
- [ ] Demo 项目中可对单段生成译文。
- [ ] 新建项目中可导入文本并生成译文。
- [ ] 生成失败时前端不崩溃。
- [ ] 适配器日志可定位失败原因。
- [ ] 断开真实 provider 后，错误提示明确。
- [ ] 重启适配器后，AS译林可恢复调用。
- [ ] 重启 AS译林后，BYO 配置仍可用。

## 7. 最小验收命令

```bash
# 适配器健康检查
curl -i http://127.0.0.1:18080/health

# 查看最近日志
curl -i http://127.0.0.1:18080/admin/calls

# AS译林后端容器内连通性测试，按实际容器名调整
docker exec -it sutra-server curl -i http://ADAPTER_HOST:18080/health
```

## 8. 决策检查点

- [ ] M0 结束后：确认协议是否足够清晰，是否继续开发适配器。
- [ ] M1 结束后：确认文本翻译是否满足当前业务需求。
- [ ] M2 结束后：确认是否需要做管理界面。
- [ ] M3 前：确认 OCR/Vision 的成本和必要性。

## 9. 当前推荐推进顺序

1. 先做探测服务器，不直接写完整适配器。
2. 抓取 BYO 登录、拉模型、翻译三个关键协议。
3. 实现最小 FastAPI 适配器。
4. 先接一个 OpenAI-compatible provider。
5. 完成 AS译林端到端单段翻译。
6. 再补流式、用量、Ollama、Vision。

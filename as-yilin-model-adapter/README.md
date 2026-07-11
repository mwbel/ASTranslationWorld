# AS译林模型通路适配器

这个目录包含两个服务：

- `probe_server`：协议探测服务器。把 AS译林 BYO key 的 `gateway_endpoint` 指向它，用来记录 AS译林后端到底请求了哪些路径和字段。
- `adapter_server`：最小模型通路适配器。按探测出的协议提供登录、模型列表和文本生成兼容接口，并转发到 OpenAI-compatible API。

当前版本优先支持 M0/M1：

- 记录并脱敏所有探测请求。
- 从 `config.yaml` 读取本地用户、provider 和模型。
- 提供兼容登录和模型列表接口的候选路径。
- 提供 OpenAI-compatible 非流式 chat completions 转发。
- 保留兜底 catch-all，用于继续观察未知协议。

## 当前 MVP 方案

当前探测到的 AS译林 关键协议是：

- `POST /api/user/login`
- `GET /v1/models`
- `POST /v1/chat/completions`

因此 MVP 不改 AS译林 前端，只改适配器网关。当前默认配置已切到用户自己的 `ModelAggregatorService`：

- `base_url = http://host.docker.internal:8890`
- `chat_path = /api/aggregate/chat`
- `upstream_model` 使用 provider-qualified model id，例如 `local:qwen3.6-27b:latest` 或 `gemini:gemini-2.5-flash`

AS译林后端仍然只访问本目录的 adapter；adapter 再把请求转成 `ModelAggregatorService /api/aggregate/chat`。这样 AS译林不直接持有 Hugging Face、Gemini、云雾或本地模型服务的 API key。

默认配置会把已验证可调用的真实模型分别暴露为独立的 AS译林模型：

| AS译林模型 ID | 实际上游模型 |
| --- | --- |
| `agg-local-qwen25` | `local:qwen2.5:14b` |
| `agg-local-qwen36` | `local:qwen3.6-27b:latest` |
| `agg-local-gemma2` | `local:gemma2:27b` |
| `agg-local-qwen36-q4` | `local:batiai/qwen3.6-27b:q4` |
| `agg-gemini-25-flash` | `gemini:gemini-2.5-flash` |

旧的 `gemini-3-flash-preview`、`hf-qwen-zh-en` 等兼容名称只作为对应真实模型的 alias，不再把不同模型名称全部映射到 Qwen2.5。未知模型会明确返回错误，不会静默回退到第一个模型。

`local:qwen3.6-27b:latest` 和 `local:batiai/qwen3.6-27b:q4` 已由聚合器改用 Ollama 原生聊天接口并完成非空响应验证，因此已重新启用。`gemini:gemini-3-flash-preview` 仍保留为 `enabled: false`，待上游模型服务稳定后再启用。

## 快速开始

复制配置：

```bash
cp examples/model-aggregator.config.yaml config.yaml
```

如果要直接参考 `宇宙模型MVP/models.yaml` 的聚合模型配置方式，可以改用：

```bash
cp examples/univmodel-style.config.yaml config.yaml
```

该风格支持：

- `provider: openai-compatible` / `provider: gemini`
- `base_url_env`、`api_key_env`、`api_keys_env`
- `model`、`model_env`
- `chat_path_env`
- `capabilities`、`privacy`、`cost`、`latency`、`priority`

启动探测服务器：

```bash
uvicorn probe_server.app:app --host 0.0.0.0 --port 18080 --app-dir as-yilin-model-adapter
```

启动适配器：

```bash
uvicorn adapter_server.app:app --host 0.0.0.0 --port 18081 --app-dir as-yilin-model-adapter
```

健康检查：

```bash
curl -i http://127.0.0.1:18080/health
curl -i http://127.0.0.1:18081/health
```

AS译林 BYO key 中填写：

```text
gateway_endpoint = http://服务器内网IP:18080  # 协议探测阶段
gateway_endpoint = http://服务器内网IP:18081  # 适配器验证阶段
username = demo
password = demo-password
```

使用默认聚合器配置时，需要先启动：

```bash
cd "/Users/Min369/Documents/同步空间/Manju/AIProjects/ModelAggregatorService"
./start.sh
```

如果适配器跑在 Docker Compose 里，`config.yaml` 中的 `http://host.docker.internal:8890` 会从容器访问 Mac 宿主机上的聚合器服务。

注意：如果 AS译林后端运行在 Docker 容器里，`127.0.0.1` 指向的是容器自身，不是宿主机。应使用宿主机内网 IP、Docker 网络别名，或把适配器加入同一个 Docker network。

## 开发顺序

1. 先启动 `probe_server`，在 AS译林页面执行“保存并登录”“拉取模型”“翻译段落”等操作。
2. 查看 `data/probe/captured-requests/` 里的请求样本。
3. 根据样本补齐 `adapter_server.protocol` 中的路径和响应格式。
4. 再切换 BYO `gateway_endpoint` 到 `adapter_server` 做端到端验证。

## 安全约束

- 日志会自动脱敏 `authorization`、`password`、`token`、`api_key` 等字段。
- 配置文件里的生产密码应使用 bcrypt hash。
- 生产环境不要把适配器直接暴露到公网。
- 管理接口后续应增加认证；当前版本只建议内网开发使用。

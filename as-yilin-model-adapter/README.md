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

## 快速开始

复制配置：

```bash
cp examples/config.example.yaml config.yaml
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

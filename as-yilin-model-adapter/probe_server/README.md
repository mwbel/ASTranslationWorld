# Probe Server

协议探测服务器会捕获所有 HTTP 请求，并把脱敏后的样本写入：

- `data/probe/requests.jsonl`
- `data/probe/captured-requests/*.json`

启动：

```bash
uvicorn probe_server.app:app --host 0.0.0.0 --port 18080 --app-dir as-yilin-model-adapter
```

AS译林 BYO key：

```text
gateway_endpoint = http://服务器内网IP:18080
username = demo
password = demo-password
```

完成探测后，查看捕获：

```bash
tail -n 20 data/probe/requests.jsonl
ls data/probe/captured-requests
```

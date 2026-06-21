# AS译林本地部署

本目录是本地隔离部署，不影响服务器上的 AS译林应用。

## 本地约定

- Web: http://127.0.0.1:18088/
- Compose project: `sutra-local`
- Containers: `sutra-local-postgres`, `sutra-local-redis`, `sutra-local-server`, `sutra-local-web`
- Volumes: `sutra-local-pgdata`, `sutra-local-redisdata`, `sutra-local-storage`
- Network: `sutra-local-net`
- Platform: `linux/amd64`
- Local auth: Web 镜像会自动登录本地测试用户，无需手动注册/登录。

## 本地测试账号

前端启动时会自动登录；如果用户不存在，会自动注册：

```text
email = local-dev@as-yilin.local
password = local-dev-password
display_name = 本地测试
```

这只是本地 Web 镜像补丁，不要用于服务器部署。

## 启动

在本目录执行：

```bash
DOCKER_HOST=unix:///Users/Min369/.colima/default/docker.sock /opt/homebrew/bin/docker compose \
  -f docker-compose.yml \
  -f compose.override.yml \
  -f compose.local.yml \
  up -d --build
```

如果镜像尚未加载，先执行：

```bash
DOCKER_HOST=unix:///Users/Min369/.colima/default/docker.sock /opt/homebrew/bin/docker load \
  -i images/sutra-images-20260611-2159-server-runtime-amd64.tar.gz
```

本机 Apple Silicon 运行该 amd64 包时，后端修复镜像依赖 `server-runtime/`：

```bash
DOCKER_HOST=unix:///Users/Min369/.colima/default/docker.sock /opt/homebrew/bin/docker create \
  --platform linux/amd64 \
  --name sutra-extract-tmp \
  sutra-server:20260611-2159-server-runtime-amd64

mkdir -p server-runtime
DOCKER_HOST=unix:///Users/Min369/.colima/default/docker.sock /opt/homebrew/bin/docker cp \
  sutra-extract-tmp:/usr/local/bin/sutra-server server-runtime/sutra-server
DOCKER_HOST=unix:///Users/Min369/.colima/default/docker.sock /opt/homebrew/bin/docker cp \
  sutra-extract-tmp:/app/tessdata server-runtime/tessdata
DOCKER_HOST=unix:///Users/Min369/.colima/default/docker.sock /opt/homebrew/bin/docker rm sutra-extract-tmp
```

## 检查

```bash
DOCKER_HOST=unix:///Users/Min369/.colima/default/docker.sock /opt/homebrew/bin/docker compose \
  -f docker-compose.yml \
  -f compose.override.yml \
  -f compose.local.yml \
  ps

curl -I http://127.0.0.1:18088/
```

## 对接本地 LLM 聚合适配器

如果使用旁边的 `../as-yilin-model-adapter`：

```bash
cd ../as-yilin-model-adapter
DOCKER_HOST=unix:///Users/Min369/.colima/default/docker.sock /opt/homebrew/bin/docker compose up -d --build
```

AS译林 BYO key 配置建议：

```text
gateway_endpoint = http://host.docker.internal:18080  # 先探测协议
gateway_endpoint = http://host.docker.internal:18081  # 再验证适配器
username = demo
password = demo-password
```

如果 LLM 聚合服务跑在 Mac 宿主机上，不要在适配器容器里配置 `127.0.0.1`，应改成 Docker/Colima 能访问宿主机的地址，例如 `http://host.docker.internal:PORT/v1` 或 `http://host.lima.internal:PORT/v1`。

## 停止

```bash
DOCKER_HOST=unix:///Users/Min369/.colima/default/docker.sock /opt/homebrew/bin/docker compose \
  -f docker-compose.yml \
  -f compose.override.yml \
  -f compose.local.yml \
  down
```

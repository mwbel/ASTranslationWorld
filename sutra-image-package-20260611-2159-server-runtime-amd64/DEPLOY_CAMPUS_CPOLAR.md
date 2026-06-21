# 校园网服务器 + cpolar 部署说明

本包是 `AS译林` 的离线 Docker 镜像部署包，适合在校园网服务器上用 Docker Compose 运行，再通过 cpolar 把 Web 入口发布到公网。

## 1. 推荐服务器配置

- CPU: 2 核起步
- 内存: 4GB 起步，8GB 更稳
- 磁盘: 100GB 起步，文档和上传文件多时建议更大
- 系统: Ubuntu 22.04 LTS 或 Ubuntu 24.04 LTS，x86_64/amd64
- 网络: 校园服务器需要能访问外网，尤其是模型/OCR API 相关服务

## 2. 复制部署包到服务器

在本地电脑执行：

```bash
scp -r sutra-image-package-20260611-2159-server-runtime-amd64 USER@SERVER_IP:/opt/sutra
```

如果 `/opt` 没有权限，可以先传到用户目录：

```bash
scp -r sutra-image-package-20260611-2159-server-runtime-amd64 USER@SERVER_IP:~/sutra
```

## 3. 服务器安装 Docker

在校园网服务器执行：

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

验证：

```bash
docker --version
docker compose version
```

## 4. 加载离线镜像

进入部署包目录：

```bash
cd /opt/sutra
```

如果你传到了用户目录：

```bash
cd ~/sutra
```

校验文件：

```bash
sha256sum -c SHA256SUMS
```

加载镜像：

```bash
docker load -i images/sutra-images-20260611-2159-server-runtime-amd64.tar.gz
docker images | grep -E 'sutra|postgres|redis'
```

## 5. 配置环境变量

复制环境变量文件：

```bash
cp .env.example .env
```

编辑：

```bash
nano .env
```

建议至少修改这些值：

```env
POSTGRES_PASSWORD=换成强密码
JWT_SECRET=换成至少32位随机字符串
WEB_PORT=8080
```

生成随机 `JWT_SECRET` 可用：

```bash
openssl rand -hex 32
```

说明：

- `WEB_PORT=8080` 是为了让 cpolar 穿透本机 `8080`，避免占用服务器系统的 80 端口。
- 如果服务器上的 `8080` 已被其他服务占用，可以改成其他空闲端口，例如本次校园网服务器实测使用 `WEB_PORT=18088`。
- 不要把 Postgres、Redis、后端服务端口直接暴露到公网。

## 5.1 后端 glibc 修复说明

本包原始 `sutra-server` 镜像内部是 Debian 12，glibc 为 2.36；后端二进制需要 `GLIBC_2.39`。如果启动后看到：

```text
/usr/local/bin/sutra-server: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.39' not found
```

请使用本包附带的修复文件：

- `Dockerfile.server-ubuntu`
- `compose.override.yml`

然后执行：

```bash
docker compose down
docker compose build sutra-server
docker compose up -d
```

这个修复会用 Ubuntu 24.04 重新封装后端运行层，并保留原来的后端程序和数据卷。

## 6. 启动应用

```bash
docker compose up -d
docker compose ps
```

查看日志：

```bash
docker compose logs -f --tail=100
```

本机验证：

```bash
curl -I http://127.0.0.1:8080/
```

如果返回 `HTTP/1.1 200 OK`，说明应用入口正常。

## 7. 安装并配置 cpolar

在 cpolar 官网注册并获取 authtoken，然后在服务器安装 cpolar。

安装后执行：

```bash
cpolar authtoken YOUR_CPOLAR_AUTHTOKEN
```

创建 HTTP 隧道：

```bash
cpolar http 8080
```

这会生成一个公网访问地址，用它访问应用。

长期使用建议购买 cpolar 专业版或以上，并配置固定二级域名或自定义域名。免费版地址会变化，且带宽较低，只适合临时测试。

## 8. cpolar 后台固定域名配置建议

如果使用固定域名，隧道目标保持：

```text
http://127.0.0.1:8080
```

不要创建这些隧道：

```text
5432  # Postgres
6379  # Redis
5555  # sutra-server backend
```

只发布 Web 入口即可。

## 9. 基础备份

备份 Postgres：

```bash
docker exec sutra-postgres pg_dump -U sutra sutra > sutra-$(date +%F).sql
```

备份 Docker volumes：

```bash
docker run --rm \
  -v sutra_pgdata:/volume \
  -v "$PWD:/backup" \
  alpine tar czf /backup/sutra-pgdata-$(date +%F).tar.gz -C /volume .

docker run --rm \
  -v sutra_sutra-storage:/volume \
  -v "$PWD:/backup" \
  alpine tar czf /backup/sutra-storage-$(date +%F).tar.gz -C /volume .
```

建议至少每天备份一次数据库和 `sutra-storage`，并把备份同步到另一台机器或网盘。

## 10. 常用维护命令

重启：

```bash
docker compose restart
```

停止：

```bash
docker compose down
```

更新镜像后重新加载并启动：

```bash
docker compose down
docker load -i images/sutra-images-20260611-2159-server-runtime-amd64.tar.gz
docker compose up -d
```

查看资源占用：

```bash
docker stats
```

查看磁盘：

```bash
df -h
docker system df
```

## 11. 上线前检查

- `.env` 已改强密码和随机 `JWT_SECRET`
- `WEB_PORT=8080`
- `docker compose ps` 全部服务正常
- `curl -I http://127.0.0.1:8080/` 返回 200
- cpolar 只穿透 8080
- Postgres/Redis 未暴露公网
- 已确认学校允许通过内网穿透发布服务
- 已设置数据库和上传文件备份

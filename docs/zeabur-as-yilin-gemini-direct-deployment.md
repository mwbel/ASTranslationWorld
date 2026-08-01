# AS译林：Zeabur + Gemini 直连部署

本文用于把当前仓库中的 AS译林 本地副本整理成一套可在 Zeabur 上上线的最小部署方案。当前目标不是迁移 `ModelAggregatorService`，而是先让 `as-yilin-model-adapter` 直接调用 Gemini API，尽快跑通线上翻译闭环。

如果你现在要在 Zeabur 控制台里逐项创建服务，优先看这份抄表版清单：

- [AS译林 Zeabur 服务清单与 env 字段清单](/Users/Min369/Documents/同步空间/Manju/AIProjects/洞见/docs/zeabur-as-yilin-service-env-checklist.md)

## 一、适用范围

只涉及以下两个模块：

- `sutra-image-package-20260611-2159-server-runtime-amd64/`
- `as-yilin-model-adapter/`

不涉及：

- `tibetan-proofreading-app/`
- `tibetan-ocr-core/`
- `tibetan-translation-services/`

## 二、推荐的线上链路

```text
浏览器
-> sutra-web
-> sutra-server
-> AS译林 BYO gateway_endpoint
-> as-yilin-model-adapter
-> Gemini API
```

当前阶段不迁移 `ModelAggregatorService`。后续如果要接回聚合器，只需调整 adapter 配置，不必重做 AS译林 主体部署。

已创建的独立 Zeabur 模板：

- https://zeabur.com/templates/RVMMX5

2026-08-01 实际执行状态：

- 已将模板部署到现有 `untitled-3` 项目，避免部署进 `ocr-review-workbench` 项目。
- 已创建 `sutra-web` 域名：`https://as-yilin-mwu.zeabur.app/`。
- 已创建 adapter 域名：`https://as-yilin-adapter-mwu.zeabur.app/`。
- 当前 `sutra-web` 返回 `502 Bad Gateway`。原因不是域名未生效，而是 GitHub 构建拿不到 AS译林运行时材料。
- `sutra-image-package-*/server-runtime/` 和 `sutra-image-package-*/images/` 被 `.gitignore` 排除；这些内容包含 `sutra-server` 二进制和 `sutra-web`/`sutra-server` 镜像包，不能直接从 GitHub 重新构建。

## 三、Zeabur 服务清单

最小闭环建议部署以下服务：

1. Postgres / RDS
2. Redis
3. `sutra-server`
4. `sutra-web`
5. `as-yilin-model-adapter`

如果线上要保留跨页续段候选能力，再增加：

6. `cross-page-service`

## 四、各服务职责

### 1. Postgres / RDS

- 参考宇宙模型 MVP，复用外部 RDS。
- 当前已创建并验证独立 schema：`as_yilin`。
- 保存 AS译林 的业务数据、项目状态、翻译和校对进度。

### 2. Redis

- 保存缓存和任务运行期状态。

### 3. `sutra-server`

- AS译林 后端主服务。
- 从 `docker-compose.yml` 可确认它依赖：
  - `DATABASE_URL`
  - `REDIS_URL`
  - `JWT_SECRET`
  - `STORAGE_PATH=/app/storage`

### 4. `sutra-web`

- 用户访问的网页入口。
- 当前本地补丁版还承载了大量 UI 改动和跨页代理逻辑。

### 5. `as-yilin-model-adapter`

- 对 AS译林 暴露兼容的 BYO 登录、模型列表、`/v1/chat/completions`。
- 向下直接转发到 Gemini API。

### 6. `cross-page-service`（可选）

- 线上保留“跨页续段候选 / 确认合并 / 撤销合并”时才需要。
- 如果只先跑通基础翻译闭环，可以先不上。

## 五、生产 Web 构建约束

当前仓库中的 `sutra-image-package-20260611-2159-server-runtime-amd64/Dockerfile.web-login-patch` 已改为 build-time 开关：

- `ENABLE_LOCAL_DEV_AUTH=0`：默认值，生产安全，禁用本地自动注册 / 自动登录
- `ENABLE_LOCAL_DEV_AUTH=1`：仅本地开发启用

本地 `compose.override.yml` 已显式设置：

```yaml
args:
  ENABLE_LOCAL_DEV_AUTH: "1"
```

因此：

- 本地副本仍保留自动登录行为
- Zeabur 或其他生产环境如果直接使用该 Dockerfile，但不传 `ENABLE_LOCAL_DEV_AUTH=1`，就不会启用本地自动登录

当前已确认的本地自动登录凭据仍仅用于本地测试：

- `local-dev@as-yilin.local`
- `local-dev-password`

生产环境不得显式传入 `ENABLE_LOCAL_DEV_AUTH=1`。

## 六、Adapter 直连 Gemini 的配置方式

建议使用本仓库新增的示例文件：

- [zeabur-gemini-direct.config.yaml](/Users/Min369/Documents/同步空间/Manju/AIProjects/洞见/as-yilin-model-adapter/examples/zeabur-gemini-direct.config.yaml)

这个配置的原则：

- 不依赖 `ModelAggregatorService`
- 不把真实 API key 写进仓库
- 通过环境变量读取 `GEMINI_BASE_URL`、`GEMINI_API_KEYS`

推荐的 Zeabur Variables：

```text
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
GEMINI_API_KEYS=key1,key2
```

说明：

- `GEMINI_API_KEYS` 支持逗号分隔多个 key，adapter 会按现有轮询 / 重试逻辑逐个尝试。
- 当前阶段建议只先暴露两个模型：
  - `agg-gemini-2.5-flash`
  - `agg-gemini-3.1-flash-lite`

## 七、各服务的关键配置

### 1. `sutra-server`

至少需要：

```text
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB?options=-csearch_path%3Das_yilin
REDIS_URL=redis://HOST:6379/0
JWT_SECRET=至少32位随机字符串
HOST=0.0.0.0
PORT=5555
STORAGE_PATH=/app/storage
OCR_VISION_MODEL=gpt-4o
RUST_LOG=sutra_server=info,tower_http=info
TZ=Asia/Shanghai
```

并挂载持久卷：

```text
/app/storage
```

### 2. `sutra-web`

- 端口：`80`
- 需要能反向代理到 `sutra-server`
- 如果启用 `cross-page-service`，还需要保留对应代理转发

### 3. `cross-page-service`

至少需要：

```text
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DB?options=-csearch_path%3Das_yilin
SUTRA_UPSTREAM=http://sutra-server:5555
```

端口：

```text
5556
```

### 4. `as-yilin-model-adapter`

建议使用：

- 工作目录：`as-yilin-model-adapter/`
- 镜像入口：`Dockerfile.adapter`
- 配置文件：`/config/config.yaml`
- 数据目录：`/data`

至少需要以下 Variables：

```text
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
GEMINI_API_KEYS=key1,key2
```

同时把示例配置复制为部署时使用的 `config.yaml`，但不要把真实 key 写入这个文件。

## 八、推荐上线顺序

1. 在 Zeabur 创建项目
   - 当前 Zeabur 已停用共享集群新建项目；需要先租用 Server，并拿到 `server-XXXXXXXX` 区域码。
   - 已测试选择现有共享区域创建项目，Zeabur 返回 `Shared clusters are deprecated. Please rent a Server and use server-XXXXXXXX as the region code.`
2. 复用外部 RDS，并使用已创建的 `as_yilin` schema
3. 添加 Redis
4. 部署 `sutra-server`
5. 给 `sutra-server` 挂载 `/app/storage` 持久卷
6. 准备并部署不带自动登录逻辑的 `sutra-web`
   - 如果直接使用当前 `Dockerfile.web-login-patch`，不要传 `ENABLE_LOCAL_DEV_AUTH=1`
7. 可选部署 `cross-page-service`
8. 部署 `as-yilin-model-adapter`
9. 在 AS译林 的 BYO 页面填写 adapter 地址并验证

## 九、BYO 页面建议填写

在 AS译林 BYO 页面中建议填写：

```text
gateway_endpoint = https://<adapter-service-domain>
username = demo
password = demo-password
```

注意：

- 不要再填 `host.docker.internal`
- 线上必须使用 Zeabur 可访问的 adapter 地址

## 十、上线后验证步骤

至少做以下 4 步：

1. 打开 `sutra-web` 页面
2. 在 BYO 页面保存 `gateway_endpoint / username / password`
3. 拉取模型列表，确认能看到：
   - `agg-gemini-2.5-flash`
   - `agg-gemini-3.1-flash-lite`
4. 选一个中文段落执行 “AI翻译 -> English”，确认能返回英文结果

## 十一、当前不做的事

本轮部署准备明确不包含：

- 把 `ModelAggregatorService` 迁到 Zeabur
- 把 `/app/storage` 立刻改造成 OSS
- 重构 `Dockerfile.web-login-patch` 的全部前端 patch
- 修改 OCR 工作台或藏文翻译工作台链路

## 十二、下一步建议

下一步只做两件事：

1. 单独整理一个“生产 web 镜像方案”，保留现有 UI patch，但移除自动登录逻辑
2. 在 Zeabur 实际创建服务并逐项填入 Variables，做第一次上线验证

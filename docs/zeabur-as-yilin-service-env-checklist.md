# AS译林 Zeabur 服务清单与 env 字段清单

这份文档只用于 Zeabur 控制台逐项创建服务时照抄。范围只包括：

- `sutra-image-package-20260611-2159-server-runtime-amd64/`
- `as-yilin-model-adapter/`

当前部署目标是：

```text
浏览器
-> sutra-web
-> sutra-server
-> BYO gateway_endpoint
-> as-yilin-model-adapter
-> Gemini API
```

不迁移 `ModelAggregatorService`。

## 一、服务总览

| 服务名 | 是否必需 | Root Directory | Dockerfile / 来源 | 对外端口 | 内部端口 | 持久化 |
|---|---|---:|---|---:|---:|---|
| Postgres / RDS | 必需 | 复用 UnivModel 外部 RDS | 已建 `as_yilin` schema | 否 | 5432 | 外部 RDS |
| Redis | 必需 | Zeabur 托管 | 托管 Redis | 否 | 6379 | Zeabur 托管卷 |
| sutra-server | 必需 | `sutra-image-package-20260611-2159-server-runtime-amd64/` | `Dockerfile.server-ubuntu` | 否 | 5555 | `/app/storage` |
| sutra-web | 必需 | `sutra-image-package-20260611-2159-server-runtime-amd64/` | `Dockerfile.web-login-patch` | 是 | 80 | 无 |
| as-yilin-model-adapter | 必需 | `as-yilin-model-adapter/` | `Dockerfile`（`Dockerfile.adapter` 保留） | 是 | 18081 | `/data` 可选 |
| cross-page-service | 可选 | `sutra-image-package-20260611-2159-server-runtime-amd64/cross-page-service/` | `cross-page-service/Dockerfile` | 否 | 5556 | 无 |

说明：

- 如果只想先跑通“中文 -> English”翻译，`cross-page-service` 可以先不上。
- `sutra-web` 当前可以继续复用同一份 patch Dockerfile，但生产环境不要传 `ENABLE_LOCAL_DEV_AUTH=1`。

## 二、Zeabur 创建顺序

建议按这个顺序建：

1. Postgres / RDS 连接
2. Redis
3. `sutra-server`
4. `sutra-web`
5. `as-yilin-model-adapter`
6. `cross-page-service`（可选）

## 三、逐服务清单

### 1. Postgres / RDS

当前采用：

- 参考宇宙模型 MVP 的方式，复用外部 RDS，不在 Zeabur 新建托管 Postgres。
- 已在该 RDS 中创建并验证独立 schema：`as_yilin`。
- 由于当前 RDS 账号没有 `CREATE DATABASE` 权限，不能直接新建独立 database；用独立 schema 隔离 AS译林数据。
- `cross-page-service` 依赖 `gen_random_uuid()`，部署前需要在目标 database 启用 `pgcrypto` 扩展。

用途：

- 存 AS译林 业务数据、翻译状态、项目状态

需要记下的连接信息：

```text
PGHOST=
PGPORT=
PGDATABASE=<复用现有 RDS database>
PGUSER=
PGPASSWORD=
PGSCHEMA=as_yilin
```

后面给 `sutra-server` 和 `cross-page-service` 拼 `DATABASE_URL` 会用到。

### 2. Redis

Zeabur 类型：

- Managed Redis

用途：

- 缓存、任务状态

需要记下的连接信息：

```text
REDIS_HOST=
REDIS_PORT=
REDIS_PASSWORD=
```

如果 Zeabur 提供完整连接串，也可以直接记：

```text
REDIS_URL=
```

### 3. sutra-server

Root Directory：

```text
sutra-image-package-20260611-2159-server-runtime-amd64
```

Dockerfile：

```text
Dockerfile.server-ubuntu
```

内部监听端口：

```text
5555
```

是否对外暴露：

- 否。建议只给 `sutra-web` 和 `cross-page-service` 走内网访问。

需要挂载的持久卷：

```text
/app/storage
```

建议的 Zeabur Variables：

```text
DATABASE_URL=postgres://PGUSER:PGPASSWORD@PGHOST:PGPORT/PGDATABASE?options=-csearch_path%3Das_yilin
REDIS_URL=redis://:REDIS_PASSWORD@REDIS_HOST:REDIS_PORT/0
HOST=0.0.0.0
PORT=5555
JWT_SECRET=<至少32位随机字符串>
STORAGE_PATH=/app/storage
OCR_VISION_MODEL=gpt-4o
RUST_LOG=sutra_server=info,tower_http=info
TZ=Asia/Shanghai
```

说明：

- `DATABASE_URL` 使用外部 RDS；密码只填 Zeabur Variables，不要提交仓库。
- `JWT_SECRET` 不要提交仓库，只填 Zeabur Variables。
- `OCR_VISION_MODEL` 当前先保留默认值即可，不影响 Gemini 文本翻译链路。

### 4. sutra-web

Root Directory：

```text
sutra-image-package-20260611-2159-server-runtime-amd64
```

Dockerfile：

```text
Dockerfile.web-login-patch
```

内部监听端口：

```text
80
```

是否对外暴露：

- 是。这个就是用户访问的前端入口。

Zeabur Variables：

```text
# 生产环境不要传 ENABLE_LOCAL_DEV_AUTH=1
```

构建约束：

- 当前 `Dockerfile.web-login-patch` 默认 `ENABLE_LOCAL_DEV_AUTH=0`
- 生产环境不要额外传 `ENABLE_LOCAL_DEV_AUTH=1`

说明：

- 本地 `compose.override.yml` 已经显式传了 `ENABLE_LOCAL_DEV_AUTH=1`，那只是本地开发行为。
- Zeabur 上如果不传这个参数，就不会启用本地自动注册 / 自动登录。

### 5. as-yilin-model-adapter

Root Directory：

```text
as-yilin-model-adapter
```

Dockerfile：

```text
Dockerfile
```

说明：`Dockerfile.adapter` 与 `Dockerfile` 内容保持等价；Zeabur 上优先使用标准文件名，避免构建器忽略自定义 Dockerfile 名。

内部监听端口：

```text
18081
```

是否对外暴露：

- 建议对外暴露，供 AS译林 BYO 的 `gateway_endpoint` 使用。
- 如果后续 Zeabur 内部域名 / 私网调用更稳定，也可以再收回公网入口。

建议挂载：

```text
/data
```

当前 Zeabur 状态：

- `as-yilin-model-adapter` 本地镜像 build 通过，`/health` 本地返回 200。
- Zeabur 服务仍显示 `CRASHED`，公网 `/health` 返回 `502 Bad Gateway`。
- Zeabur CLI 当前无法读取该服务运行日志，`restart` 返回平台内部错误。
- 该服务目前未设置 `GEMINI_API_KEYS`，上线翻译前需要在 Zeabur Variables 中补入真实 key。

需要准备的配置文件：

- 基于 [zeabur-gemini-direct.config.yaml](/Users/Min369/Documents/同步空间/Manju/AIProjects/洞见/as-yilin-model-adapter/examples/zeabur-gemini-direct.config.yaml) 生成部署用 `config.yaml`

建议的 Zeabur Variables：

```text
GEMINI_BASE_URL=https://generativelanguage.googleapis.com
GEMINI_API_KEYS=<key1,key2>
ADAPTER_CONFIG=/config/config.yaml
ADAPTER_DATA_DIR=/data/adapter
```

部署时需要注意：

- `GEMINI_API_KEYS` 可填逗号分隔多个 key
- 不要把真实 key 写进仓库的 `config.yaml`
- `config.yaml` 里只保留 `base_url_env`、`api_keys_env` 这类环境变量引用

### 6. cross-page-service（可选）

Root Directory：

```text
sutra-image-package-20260611-2159-server-runtime-amd64/cross-page-service
```

Dockerfile：

```text
Dockerfile
```

内部监听端口：

```text
5556
```

是否对外暴露：

- 否。建议只给 `sutra-web` 内网反代访问。

建议的 Zeabur Variables：

```text
DATABASE_URL=postgres://PGUSER:PGPASSWORD@PGHOST:PGPORT/PGDATABASE?options=-csearch_path%3Das_yilin
SUTRA_UPSTREAM=http://sutra-server:5555
```

说明：

- 如果线上暂时不需要“跨页续段候选 / 确认合并 / 撤销合并”，可以后补这个服务。

## 四、推荐的 adapter 配置原则

当前建议只暴露两个 Gemini 模型：

```text
agg-gemini-2.5-flash
agg-gemini-3.1-flash-lite
```

这样排错最简单，也能满足当前“先跑通翻译”的目标。

## 五、BYO 页面最终填写

在 AS译林 的 BYO 页面填写：

```text
gateway_endpoint=https://<adapter 服务域名>
username=demo
password=demo-password
```

不要再填：

```text
http://host.docker.internal:18081
```

因为那只是本地 Docker/Colima 的地址。

## 六、最小上线验收

至少做这 4 步：

1. 打开 `sutra-web` 首页
2. 保存 BYO 配置
3. 拉到模型列表，确认能看到：
   - `agg-gemini-2.5-flash`
   - `agg-gemini-3.1-flash-lite`
4. 选一个中文段落点 `AI翻译 -> English`，确认返回英文结果

## 七、当前明确不做的事

这份 checklist 不包含：

- 迁移 `ModelAggregatorService`
- 立刻把 `/app/storage` 改成 OSS
- 修复本机 Colima / Docker
- 浏览器级 UI 验证

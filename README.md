# Fashion Report Platform

aimoda 时尚情报与 Agent 平台。

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui |
| 后端 | FastAPI + Python 3.12 |
| 数据库 | PostgreSQL + Redis |
| 向量检索 | Qdrant |
| 部署 | Docker Compose |

## 环境约定

项目的运行环境变量现在统一收口到 `env/` 目录：

- `env/dev.env`：dev 环境实际配置
- `env/prod.env`：prod 环境实际配置
- `env/dev.env.example`：dev 模板
- `env/prod.env.example`：prod 模板

说明：

- 运行时与部署配置只认 `env/dev.env` / `env/prod.env`
- 根目录 `.env`、`.env.deploy`、`backend/.env` 不再作为正式入口
- `frontend/.env.example` 保留给 Vite 前端私有变量示例，不参与主运行栈配置

## 快速开始

### 1. 准备环境文件

```bash
cp env/dev.env.example env/dev.env
cp env/prod.env.example env/prod.env
```

按机器实际情况填写密钥、域名、Qdrant、OSS、LLM 等配置。

### 2. 本地启动 dev

```bash
docker compose --env-file env/dev.env -p aimoda-dev up -d --build
```

### 3. 本地启动 prod 预演

```bash
docker compose --env-file env/prod.env -p aimoda-prod up -d --build
```

### 4. 使用脚本

```bash
./scripts/deploy-stack.sh dev
./scripts/deploy-stack.sh prod
./scripts/restart-stack.sh dev
./scripts/restart-stack.sh prod
```

## 项目结构

```
fashion-report/
├── backend/              # FastAPI API / auth / chat / reports
├── frontend/             # React SPA
├── services/             # MCP / gallery / style services
├── env/                  # 统一环境入口与模板
├── scripts/              # 部署与运维脚本
├── docs/                 # 文档
├── nginx.conf            # 容器内 Nginx 配置
└── docker-compose.yml    # 主编排文件
```

## 安全建议

- 不要把真实密钥提交到仓库
- 建议仅提交 `env/*.env.example`
- 当密钥在聊天、截图或日志中出现后，尽快安排轮换

# Fashion Report Platform

World Wear Watch Daily (WWWD) - 时尚趋势报告平台

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui |
| 后端 | Node.js + Express + TypeScript |
| 数据库 | SQLite (better-sqlite3) |
| 认证 | JWT 双 Token |
| 部署 | Docker Compose |

## 项目结构

```
fashion-report/
├── frontend/           # React SPA
│   ├── src/
│   │   ├── app/        # 路由配置
│   │   ├── components/ # UI 组件
│   │   ├── features/   # 功能模块
│   │   └── lib/        # 工具函数
│   └── public/         # 静态资源
├── backend/            # Express API
│   ├── src/
│   │   ├── modules/    # 业务模块
│   │   ├── middleware/ # 中间件
│   │   ├── db/         # 数据库
│   │   └── skills/     # MCP Skill 文件
│   └── tests/          # 测试文件
├── scripts/            # 运维脚本
├── nginx.conf          # Nginx 配置
└── docker-compose.yml  # Docker 编排
```

## 快速开始

### 环境要求

- Node.js 22+
- Docker & Docker Compose

### 本地开发

```bash
# 后端
cd backend
npm install
npm run dev

# 前端
cd frontend
npm install
npm run dev
```

### Docker 部署

```bash
# 配置环境变量
cp .env.example .env.production
vim .env.production

# 构建并启动
docker-compose --env-file .env.production up -d --build
```

### 默认管理员账号

- 邮箱: `admin@fashion-report.local`
- 密码: `ChangeMe123!`

## MCP 工具

平台提供 MCP 工具供 AI Agent 使用：

- `get_report_spec` - 获取报告生成规范
- `upload_report` - 上传报告压缩包

## License

MIT
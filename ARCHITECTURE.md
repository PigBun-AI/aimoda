# Fashion Report 平台 - 架构方案 (v2)

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vite + React 19 + TypeScript + Tailwind 4 + shadcn/ui |
| 后端 | Node.js + Express |
| 数据库 | SQLite (better-sqlite3) |
| 认证 | JWT 双 Token |
| 部署 | Docker Compose (2容器: nginx + api) |

---

## 项目结构

```
fashion-report/
├── frontend/           # React SPA
├── backend/            # Express API
├── nginx.conf
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
└── reports/            # 初始报告（构建时复制到 volume）
```

---

## Docker Compose (Named Volume 方案)

```yaml
version: '3.9'

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./frontend/dist:/usr/share/nginx/html:ro
      - reports:/reports        # Named volume
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped

  api:
    build: ./backend
    environment:
      - NODE_ENV=production
      - PORT=3000
      - JWT_SECRET=${JWT_SECRET}
    volumes:
      - db:/data                 # Named volume (SQLite)
      - reports:/reports         # Named volume
    restart: unless-stopped

volumes:
  db:
  reports:
```

---

## 报告管理脚本

创建 `scripts/manage-reports.sh`，方便日常操作：

```bash
#!/bin/bash
# manage-reports.sh - 报告管理脚本

case "$1" in
  # 导入报告到 volume
  import)
    echo "Importing reports to Docker volume..."
    docker run --rm -v fashion-report_reports:/reports -v "$(pwd)/reports:/src" alpine \
      sh -c "cp -r /src/* /reports/"
    ;;

  # 导出报告从 volume
  export)
    echo "Exporting reports from Docker volume..."
    mkdir -p ./exported-reports
    docker run --rm -v fashion-report_reports:/reports -v "$(pwd)/exported-reports:/dst" alpine \
      sh -c "cp -r /reports/* /dst/"
    ;;

  # 列出报告
  list)
    docker volume inspect fashion-report_reports --format '{{ .Mountpoint }}'
    docker run --rm -v fashion-report_reports:/reports alpine ls /reports
    ;;

  # 备份整个数据（数据库 + 报告）
  backup)
    BACKUP_DIR="./backups/backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    docker run --rm -v fashion-report_db:/data -v "$BACKUP_DIR:/backup" alpine \
      cp /data/fashion-report.db /backup/
    docker run --rm -v fashion-report_reports:/reports -v "$BACKUP_DIR:/backup" alpine \
      sh -c "cp -r /reports/* /backup/reports/"
    echo "Backup saved to: $BACKUP_DIR"
    ;;

  # 恢复数据
  restore)
    if [ -z "$2" ]; then
      echo "Usage: $0 restore <backup-dir>"
      exit 1
    fi
    docker run --rm -v fashion-report_db:/data -v "$2:/backup" alpine \
      cp /backup/fashion-report.db /data/
    docker run --rm -v fashion-report_reports:/reports -v "$2/reports:/src" alpine \
      sh -c "cp -r /src/* /reports/"
    echo "Restore complete"
    ;;

  *)
    echo "Usage: $0 {import|export|list|backup|restore}"
    exit 1
    ;;
esac
```

---

## 迁移操作示例

### 迁移到新服务器

```bash
# 旧服务器
docker run --rm -v fashion-report_db:/data -v "$(pwd):/backup" alpine \
  cp /data/fashion-report.db /backup/
docker run --rm -v fashion-report_reports:/reports -v "$(pwd):/backup" alpine \
  sh -c "cp -r /reports/* /backup/"

# 复制 backup 目录到新服务器
scp -r backups/* new-server:/path/to/fashion-report/

# 新服务器
cd /path/to/fashion-report
docker-compose up -d
./scripts/manage-reports.sh restore ./backups/backup-xxx
```

### 备份策略（建议加入 cron）

```bash
# 每天凌晨 3 点自动备份
0 3 * * * cd /path/to/fashion-report && ./scripts/manage-reports.sh backup
```

---

## 一键部署命令

```bash
# 1. 克隆项目
git clone <repo> fashion-report
cd fashion-report

# 2. 配置环境变量
cp .env.example .env.production
vim .env.production  # 设置 JWT_SECRET

# 3. 导入初始报告（如果有）
./scripts/manage-reports.sh import

# 4. 启动服务
docker-compose up -d --build

# 5. 查看状态
docker-compose ps
```

---

## 优势总结

| 特性 | Named Volume 方案 |
|------|-------------------|
| **迁移** | 一行命令导出/导入 |
| **备份** | 脚本自动化，定时任务 |
| **权限** | 无需手动处理 |
| **团队协作** | 共享 docker-compose.yml 即可 |
| **查看文件** | `docker run -v ... alpine ls /reports` |

---

## MCP 工具设计

OpenClaw Agent 通过 MCP 工具与平台交互，流程如下：

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw Agent                           │
│                                                              │
│  1. get_report_spec ──────────────────────────────────┐     │
│       │                                                   │   │
│       ▼                                                   │   │
│  ┌─────────────────┐    2. 生成报告    ┌─────────────┐  │   │
│  │ 获取文件夹结构  │ ──────────────▶  │ 按规范生成  │  │   │
│  │ + iframe 规范   │                  │ HTML+images │  │   │
│  └─────────────────┘                  └──────┬──────┘  │   │
│                                                │          │   │
│                                                ▼          │   │
│                                    3. upload_report ──────┘   │
│                                         │                    │
│                                         ▼                     │
│                              ┌─────────────────────┐          │
│                              │ 平台 API             │          │
│                              │ - 解压/验证          │          │
│                              │ - 提取元数据         │          │
│                              │ - 注册到数据库       │          │
│                              └─────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

### 工具列表

| 工具 | 功能 | 优先级 |
|------|------|--------|
| `get_report_spec` | 查询最新的文件夹结构规范 + iframe 解析规则 | P0 |
| `upload_report` | 上传 zip 文件，自动解压、验证、注册 | P1 |

### get_report_spec 返回规范

```typescript
interface ReportSpec {
  version: "1.0.0",
  updatedAt: "2026-03-13",
  description: "OpenClaw 报告生成规范 - Agent 生成前请查阅",
  folderStructure: {
    root: "品牌-季节-年份/",
    required: [
      "index.html",      // 必选：主报告页面（全屏滚动）
      "overview.html",   // 必选：品牌纵览页面（三栏 dashboard）
      "images/"          // 必选：图片目录
    ],
    optional: [
      "metadata.json",   // 可选：元数据（自动从 HTML 提取）
    ],
    images: {
      original: "images/look-001.jpg ~ look-052.jpg",
      compressed: "images/compressed/look-001-400.jpg (可选)",
      thumbnails: "images/thumbnails/look-001-thumb.jpg (可选)"
    }
  },
  iframeRules: {
    indexHtml: {
      type: "全屏滚动报告",
      pages: "每页 100vh，CSS scroll-snap 对齐",
      structure: "7 个 section，分别展示不同风格系列",
      title: "品牌 + 季节 + 系列，如 'Zimmermann Fall 2026 RTW'"
    },
    overviewHtml: {
      type: "三栏 dashboard",
      left: "38% - 缩略图网格（按风格系列分组）",
      center: "35% - 色彩/廓形/面料统计",
      right: "27% - 雷达图 + 风格占比 + 季度总结"
    },
    cssIsolation: "iframe 天然隔离，外层样式不影响内层",
    fonts: "Playfair Display (标题) + Inter (正文)"
  },
  naming: {
    folder: "品牌-季节-年份（英文，中横线分隔）",
    example: "zimmermann-fall-2026, chanel-spring-2027"
  }
}
```

### upload_report API

```http
POST /api/reports/upload
Content-Type: multipart/form-data
Authorization: Bearer <token>

Body:
  - file: zip 压缩包（包含 index.html, overview.html, images/）

Response (成功):
{
  "success": true,
  "message": "报告上传成功",
  "report": {
    "id": 1,
    "slug": "zimmermann-fall-2026",
    "title": "Zimmermann Fall 2026 RTW",
    "brand": "Zimmermann",
    "season": "Fall 2026",
    "lookCount": 52
  }
}

Response (失败):
{
  "success": false,
  "error": "缺少必需文件 index.html"
}
```

### 当前实现

MVP 阶段采用**文件方案**（复制到共享目录 + chokidar 扫描），MCP 工具作为未来可选扩展：

```javascript
// backend/src/routes/reports.js 预留下传接口
router.post('/upload', uploadMiddleware, reportController.upload);  // 未来实现
router.get('/spec', reportController.getSpec);                        // 可提前实现
```

### 升级信号

当出现以下情况时，考虑实现 MCP 工具：
1. OpenClaw 部署到远程机器，无法访问共享存储
2. 报告数量增多，需要批量管理和自动化
3. 需要报告审核流程
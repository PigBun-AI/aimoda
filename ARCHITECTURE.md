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
├── env/
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
cp env/prod.env.example env/prod.env
vim env/prod.env

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
│  1. get_openclaw_upload_contract ────────────────────┐     │
│       │                                                   │   │
│       ▼                                                   │   │
│  ┌─────────────────┐    2. 生成报告    ┌─────────────┐  │   │
│  │ 获取机器合同    │ ──────────────▶  │ 按合同生成  │  │   │
│  │ + next_action   │                  │ HTML+assets │  │   │
│  └─────────────────┘                  └──────┬──────┘  │   │
│                                                │          │   │
│                                                ▼          │   │
│                              3. prepare_report_upload ───┐    │
│                                                           │    │
│                              4. 直传 zip 到 OSS ─────────┤    │
│                                                           │    │
│                              5. complete_report_upload ──┘    │
│                                         │                     │
│                                         ▼                     │
│                              ┌─────────────────────┐          │
│                              │ 平台 API             │          │
│                              │ - 校验 staging 对象  │          │
│                              │ - 异步解压/验证      │          │
│                              │ - 提取元数据         │          │
│                              │ - 注册到数据库       │          │
│                              └─────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

### 工具列表

| 工具 | 功能 | 优先级 |
|------|------|--------|
| `get_openclaw_upload_contract` | 查询 OpenClaw 机器可执行上传合同 + next_action | P0 |
| `get_openclaw_report_template` | 查询推荐 ZIP 模板与 manifest 模板 | P0 |
| `get_report_spec` | 查询完整人类可读规范，供调试/人工核对 | P2 |
| `prepare_report_upload` | 创建直传 OSS 的上传任务，返回预签名 URL | P1 |
| `complete_report_upload` | 直传完成后通知平台开始异步处理 | P1 |
| `get_report_upload_status` | 查询异步任务状态与最终报告结果 | P1 |
| `upload_report` | 旧版代理上传，保留兼容但不推荐 | Deprecated |

### get_openclaw_upload_contract 返回合同

```typescript
interface OpenClawUploadContract {
  version: "1.0.0",
  requiredManifestFields: ["slug", "brand", "season", "year", "entryHtml"],
  optionalManifestFields: ["overviewHtml", "coverImage"],
  hardFailures: Array<{ code: string; when: string }>,
  serverAutofixes: string[],
  workflow: string[],
  toolPolicy: {
    alwaysCallContractFirst: true,
    neverUseLegacyUpload: true,
    alwaysFollowNextAction: true
  }
}
```

### 两段式上传 API

#### 1) prepare_report_upload

```json
{
  "success": true,
  "job": {
    "id": "job-123",
    "status": "pending"
  },
  "upload": {
    "method": "PUT",
    "url": "https://oss-signed-url",
    "headers": {
      "Content-Type": "application/zip"
    },
    "objectKey": "report-uploads/job-123/report.zip",
    "expiresAt": "2026-04-05T12:00:00Z"
  },
  "next_action": {
    "type": "upload_zip_to_oss"
  }
}
```

#### 2) 调用方直传到 OSS

- 使用 `upload.method` / `upload.url` / `upload.headers`
- 将 zip 二进制直接上传到 OSS
- 不再经过 Cloudflare / 平台应用层中转

#### 3) complete_report_upload

```json
{
  "success": true,
  "job": {
    "id": "job-123",
    "status": "processing"
  },
  "next_action": {
    "type": "poll_report_upload_status",
    "job_id": "job-123"
  }
}
```

#### 4) get_report_upload_status

```json
{
  "success": true,
  "job": {
    "id": "job-123",
    "status": "failed",
    "errorMessage": "{\"code\":\"missing_manifest_field\",\"message\":\"manifest 缺少必填字段 entryHtml\"}"
  },
  "error": {
    "code": "missing_manifest_field",
    "message": "manifest 缺少必填字段 entryHtml"
  },
  "next_action": {
    "type": "fix_report_package_and_retry"
  }
}
```

这个设计把“控制面”和“数据面”分离：

- MCP / 平台 API：只做任务编排、鉴权、状态查询
- OSS：承担大文件传输
- Backend Worker：承担异步解压、校验、入库

### 当前实现

MVP 阶段采用**文件方案**（复制到共享目录 + chokidar 扫描），MCP 工具作为未来可选扩展：

```javascript
// backend/src/routes/reports.js 预留下传接口
router.post('/upload/prepare', reportController.prepareUpload);
router.post('/upload/complete', reportController.completeUpload);
router.get('/upload-jobs/:jobId', reportController.getUploadJob);
router.get('/spec', reportController.getSpec);
```

### 升级信号

当出现以下情况时，考虑实现 MCP 工具：
1. OpenClaw 部署到远程机器，无法访问共享存储
2. 报告数量增多，需要批量管理和自动化
3. 需要报告审核流程

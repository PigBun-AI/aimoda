# Artifact 存储架构设计方案 (v1.0)

**任务**: Task #2 - Long-Running Task Artifacts Design
**作者**: artifact-expert
**日期**: 2026-03-20
**状态**: 设计完成

---

## 1. 背景与目标

### 1.1 当前系统状态

现有系统为时尚 AI 助手平台，架构如下：

| 组件 | 技术 | 说明 |
|------|------|------|
| 前端 | React 19 + TypeScript | SPA，单页应用 |
| 后端 | Python FastAPI | 新架构，已从 Node.js 迁移 |
| 主数据库 | SQLite | 用户、报告、订阅、会话 |
| 消息数据库 | PostgreSQL | 聊天会话元数据 (新引入) |
| 向量数据库 | Qdrant | 时尚图片向量检索 |
| 文件存储 | Docker Named Volume (`reports:`) | 报告 HTML 文件 |
| 部署 | Docker Compose | nginx + api 双容器 |

Agent 通过 LangGraph + SSE 与前端通信，当前 agent 的 `image_url` 直接指向 Qdrant 中存储的外部 URL。

### 1.2 设计目标

1. **统一管理** - 所有 artifact（图片、文档、代码、数据）纳入统一存储体系
2. **分层存储** - 根据文件大小和访问频率选择最优存储层级
3. **生命周期管理** - 临时 artifact 自动清理，重要 artifact 永久保留
4. **性能优先** - 缩略图快速加载，大文件按需加载
5. **可扩展** - 支持未来引入 MinIO/S3 而无需大幅重构

---

## 2. Artifact 分类体系

### 2.1 四大类型

```
Artifact
├── Type-1: 时尚图片 (Fashion Images)
├── Type-2: 报告文档 (Report Documents)
├── Type-3: 数据产物 (Data Products)
└── Type-4: 代码产物 (Code Artifacts)
```

### 2.2 Type-1: 时尚图片

| 子类型 | 大小范围 | 来源 | 示例 |
|--------|----------|------|------|
| 高分辨率原图 | 5-20 MB | Vogue Runway 爬取、AI 生成 | `look-001.jpg` |
| 缩略图 (Thumb) | 50-100 KB | 自动生成 | `look-001-thumb.jpg` |
| 中等尺寸 (Medium) | 200-400 KB | 自动生成 | `look-001-800.jpg` |
| 用户上传图片 | 1-10 MB | 用户头像、参考图 | avatar.jpg |

**存储策略**:
- 原图存入 MinIO/S3，私有桶
- 缩略图/中等尺寸存入 CDN 缓存
- Qdrant 中的 `image_url` 指向 CDN URL

### 2.3 Type-2: 报告文档

| 子类型 | 大小范围 | 来源 | 示例 |
|--------|----------|------|------|
| WWWD HTML 报告 | 500 KB - 5 MB | Agent 生成 | `zimmermann-fall-2026/index.html` |
| Overview HTML | 100-500 KB | Agent 生成 | `zimmermann-fall-2026/overview.html` |
| 封面截图 | 200-500 KB | Playwright 截取 | `zimmermann-fall-2026/cover.jpg` |
| 报告图片 | 100 KB - 10 MB | 报告内嵌图片 | `zimmermann-fall-2026/images/*.jpg` |
| 结构化元数据 | 1-50 KB | 自动提取 | `zimmermann-fall-2026/metadata.json` |

**存储策略**:
- 整站存入 `reports:` Docker volume（当前方案）
- 长期方案：迁移至 MinIO 私有桶，通过 nginx 反向代理访问

### 2.4 Type-3: 数据产物

| 子类型 | 大小范围 | 来源 | 示例 |
|--------|----------|------|------|
| API 响应缓存 | 10 KB - 500 KB | LLM 调用结果 | `trend-analysis-2026-03.json` |
| 时尚趋势分析结果 | 50 KB - 5 MB | Agent 分析 | `color-trends-spring-2026.json` |
| 向量检索结果 | 5-50 KB | Qdrant 查询结果 | 会话内缓存 |

**存储策略**:
- <1 MB: 存入 PostgreSQL JSONB 字段
- 1-10 MB: 存入 MinIO，引用 URL
- >10 MB: 存入 MinIO，存入 PostgreSQL 元数据表

### 2.5 Type-4: 代码产物

| 子类型 | 大小范围 | 来源 | 示例 |
|--------|----------|------|------|
| 爬虫脚本 | 5-50 KB | Agent 动态生成 | `crawler-zimmermann-2026.py` |
| 数据处理脚本 | 5-100 KB | Agent 动态生成 | `process-images.py` |
| HTML 报告模板 | 10-200 KB | Agent 生成 | `report-template.html` |

**存储策略**:
- 存入 MinIO 私有桶
- PostgreSQL 元数据表记录引用

---

## 3. 存储架构

### 3.1 存储层级

```
┌─────────────────────────────────────────────────────────────────┐
│                        访问层 (Access Layer)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Frontend   │  │  CDN (Nginx) │  │  Agent / OpenClaw    │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
└─────────┼─────────────────┼────────────────────┼──────────────┘
          │                 │                    │
          ▼                 ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                       缓存层 (Cache Layer)                       │
│  ┌──────────────────┐          ┌──────────────────────────┐  │
│  │  Browser Cache    │          │  CDN Edge Cache (nginx)    │  │
│  │  (ETag/Expires)   │          │  - HTML reports           │  │
│  │                   │          │  - Thumbnails             │  │
│  └──────────────────┘          └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       对象存储 (Object Storage)                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    MinIO / S3-Compatible                │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │   │
│  │  │ fashion-    │  │ fashion-    │  │ fashion-    │      │   │
│  │  │ images/     │  │ reports/    │  │ data/       │      │   │
│  │  │ (原图+缩略图) │  │ (HTML+PDF)  │  │ (JSON+代码) │      │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │   │
│  │                                                       │   │
│  │  生命周期策略:                                         │   │
│  │    - images/thumbnails/  → 90天后转为 Infrequent Access │   │
│  │    - images/originals/  → 永久保留                     │   │
│  │    - data/tmp/          → 24小时后自动删除             │   │
│  │    - reports/           → 永久保留                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       元数据层 (Metadata Layer)                   │
│  ┌──────────────────────┐      ┌────────────────────────────┐  │
│  │     PostgreSQL        │      │        SQLite              │  │
│  │  (chat_sessions,      │      │  (users, reports,          │  │
│  │   chat_messages,      │      │   subscriptions)           │  │
│  │   artifacts_metadata) │      │                            │  │
│  └──────────────────────┘      └────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 存储方案对比与推荐

| 方案 | 小文件 (<1 MB) | 大文件 (>=1 MB) | 运维成本 | 推荐 |
|------|---------------|----------------|----------|------|
| **方案A: 纯 MinIO** | MinIO | MinIO | 中 | P1 目标 |
| **方案B: 本地 FS + DB** | PostgreSQL JSONB / SQLite | Docker Volume | 低 | P0 当前 |
| **方案C: 混合方案** | PostgreSQL JSONB | MinIO | 中高 | P2 过渡 |

**推荐方案：方案C（混合方案）分阶段实施**

- **当前阶段 (P0)**: 沿用 Docker Volume + PostgreSQL JSONB
- **短期阶段 (P1)**: 引入 MinIO，图片迁移至 MinIO
- **长期阶段 (P2)**: 全量迁移至 MinIO，移除本地 FS 依赖

### 3.3 S3 Bucket 结构

```
fashion-artifacts/
├── images/
│   ├── originals/          # 高分辨率原图，永久保留
│   │   └── {brand}/{year}/{season}/{image_id}.{ext}
│   ├── thumbnails/         # 缩略图，90天降级
│   │   └── {brand}/{year}/{season}/{image_id}_thumb.{ext}
│   ├── medium/             # 中等尺寸，90天降级
│   │   └── {brand}/{year}/{season}/{image_id}_800.{ext}
│   └── user-uploads/       # 用户上传，永久保留
│       └── {user_id}/{filename}
├── reports/                # 报告文档，永久保留
│   └── {brand}-{season}-{year}/
│       ├── index.html
│       ├── overview.html
│       ├── cover.jpg
│       ├── metadata.json
│       └── images/
├── data/                   # 数据产物
│   ├── tmp/                # 临时数据，24小时自动删除
│   ├── cached/             # API 缓存，7天 TTL
│   └── analysis/           # 分析结果，永久保留
│       └── {session_id}/{timestamp}.json
└── code/                   # 代码产物，永久保留
    └── {session_id}/{script_name}.py
```

---

## 4. 数据库设计

### 4.1 PostgreSQL: artifacts_metadata 表

```sql
CREATE TABLE artifacts_metadata (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    artifact_type    TEXT NOT NULL CHECK (artifact_type IN ('image', 'report', 'data', 'code')),
    storage_key     TEXT NOT NULL UNIQUE,           -- S3 key, e.g. "images/originals/chanel/2026/spring/look-001.jpg"
    storage_backend TEXT NOT NULL DEFAULT 'minio'    CHECK (storage_backend IN ('minio', 'local', 'db')),
    file_name       TEXT NOT NULL,
    mime_type       TEXT,
    file_size       BIGINT NOT NULL,                -- bytes
    width           INTEGER,                         -- images only
    height          INTEGER,                         -- images only
    checksum        TEXT,                            -- SHA256 for integrity
    bucket          TEXT,                            -- S3 bucket name
    access_url      TEXT,                            -- CDN or signed URL
    expires_at      TIMESTAMPTZ,                     -- TTL, NULL = permanent
    is_pinned       BOOLEAN NOT NULL DEFAULT FALSE,  -- user pin, prevents auto-deletion
    created_by      INTEGER NOT NULL,                -- user_id
    session_id      TEXT,                            -- optional, for grouping
    metadata_json   JSONB,                           -- extra metadata
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_artifacts_type ON artifacts_metadata(artifact_type);
CREATE INDEX idx_artifacts_created_by ON artifacts_metadata(created_by);
CREATE INDEX idx_artifacts_session ON artifacts_metadata(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_artifacts_expires ON artifacts_metadata(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_artifacts_storage_key ON artifacts_metadata(storage_key);

-- 生命周期: 自动删除过期临时文件 (pg_cron)
-- SELECT cron.schedule('cleanup-artifacts', '0 * * * *', $$DELETE FROM artifacts_metadata WHERE expires_at < NOW() AND is_pinned = FALSE$$);
```

### 4.2 PostgreSQL: chat_messages 表 (扩展现有 chat_sessions)

```sql
CREATE TABLE chat_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content         TEXT,                            -- 纯文本内容
    artifacts       JSONB NOT NULL DEFAULT '[]',     -- 关联的 artifact IDs
    model           TEXT,                            -- LLM model used
    token_count     INTEGER,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_session ON chat_messages(session_id);
CREATE INDEX idx_messages_created ON chat_messages(created_at);

-- artifacts JSONB 格式示例:
-- [
--   {"artifact_id": "uuid-xxx", "type": "image", "display": "inline"},
--   {"artifact_id": "uuid-yyy", "type": "data", "display": "link"}
-- ]
```

### 4.3 SQLite 扩展 (可选，用于轻量级场景)

```sql
-- 对于不需要 PostgreSQL 的轻量部署，可以扩展现有 SQLite
CREATE TABLE IF NOT EXISTS artifacts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    artifact_type   TEXT NOT NULL,
    storage_key     TEXT NOT NULL UNIQUE,
    storage_backend TEXT NOT NULL DEFAULT 'local',
    file_name       TEXT NOT NULL,
    file_size       INTEGER NOT NULL,
    is_pinned       INTEGER NOT NULL DEFAULT 0,
    expires_at      TEXT,
    created_by      INTEGER NOT NULL,
    session_id      TEXT,
    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. API 设计

### 5.1 Artifact 上传

```http
POST /api/artifacts/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

Fields:
  - file: binary (required)
  - artifact_type: "image" | "report" | "data" | "code" (required)
  - session_id: string (optional)
  - is_pinned: boolean (optional, default false)

Response (201):
{
  "id": "uuid-xxx",
  "artifact_type": "image",
  "file_name": "look-001.jpg",
  "file_size": 5242880,
  "storage_key": "images/originals/chanel/2026/spring/look-001.jpg",
  "access_url": "https://cdn.example.com/images/originals/chanel/2026/spring/look-001.jpg",
  "checksum": "sha256:abc123...",
  "created_at": "2026-03-20T12:00:00Z"
}
```

### 5.2 Artifact 查询

```http
GET /api/artifacts?type=image&session_id={session_id}&limit=20&offset=0
Authorization: Bearer <token>

Response (200):
{
  "artifacts": [
    {
      "id": "uuid-xxx",
      "artifact_type": "image",
      "file_name": "look-001.jpg",
      "file_size": 5242880,
      "width": 4000,
      "height": 6000,
      "access_url": "https://cdn.example.com/...",
      "is_pinned": false,
      "created_at": "2026-03-20T12:00:00Z"
    }
  ],
  "total": 45,
  "limit": 20,
  "offset": 0,
  "has_more": true
}
```

### 5.3 单个 Artifact 查询

```http
GET /api/artifacts/{id}
Authorization: Bearer <token>

Response (200):
{
  "id": "uuid-xxx",
  "artifact_type": "image",
  "storage_key": "images/originals/...",
  "file_name": "look-001.jpg",
  "mime_type": "image/jpeg",
  "file_size": 5242880,
  "width": 4000,
  "height": 6000,
  "checksum": "sha256:abc123...",
  "access_url": "https://cdn.example.com/...",
  "expires_at": null,
  "is_pinned": false,
  "metadata": {}
}
```

### 5.4 Artifact 更新

```http
PATCH /api/artifacts/{id}
Authorization: Bearer <token>
Content-Type: application/json

{
  "is_pinned": true,
  "metadata": {"description": "Important reference image"}
}

Response (200):
{
  "id": "uuid-xxx",
  "is_pinned": true,
  "updated_at": "2026-03-20T12:05:00Z"
}
```

### 5.5 Artifact 删除

```http
DELETE /api/artifacts/{id}
Authorization: Bearer <token>

Response (204): No Content
```

### 5.6 批量删除

```http
DELETE /api/artifacts
Authorization: Bearer <token>
Content-Type: application/json

{
  "ids": ["uuid-xxx", "uuid-yyy"]
}

Response (200):
{
  "deleted": 2
}
```

### 5.7 下载/流式访问

```http
GET /api/artifacts/{id}/download
Authorization: Bearer <token>

Response (200):
- Content-Disposition: attachment; filename="look-001.jpg"
- Content-Type: image/jpeg
- Body: binary stream

# 或者对于图片预览:
GET /api/artifacts/{id}/preview?size=thumbnail
Response (302): Redirect to CDN URL
```

---

## 6. 生命周期管理

### 6.1 生命周期规则

| Artifact 类型 | 子类型 | 默认 TTL | 永久保留条件 | 自动清理 |
|--------------|--------|----------|-------------|---------|
| image | originals | 无 | 始终 | 否 |
| image | thumbnails | 90 天 | - | 是 |
| image | medium | 90 天 | - | 是 |
| image | user-uploads | 无 | 始终 | 否 |
| report | HTML/PDF | 无 | 始终 | 否 |
| data | tmp | 24 小时 | - | 是 |
| data | cached | 7 天 | - | 是 |
| data | analysis | 无 | 始终 | 否 |
| code | scripts | 无 | 始终 | 否 |

### 6.2 生命周期实现

**MinIO 生命周期策略** (通过 MinIO Console 或 mc ilm):

```json
{
  "Rules": [
    {
      "ID": "cleanup-thumbnails-90d",
      "Status": "Enabled",
      "Filter": {"Prefix": "images/thumbnails/"},
      "Expiration": {"Days": 90}
    },
    {
      "ID": "cleanup-tmp-24h",
      "Status": "Enabled",
      "Filter": {"Prefix": "data/tmp/"},
      "Expiration": {"Days": 1}
    },
    {
      "ID": "cleanup-cached-7d",
      "Status": "Enabled",
      "Filter": {"Prefix": "data/cached/"},
      "Expiration": {"Days": 7}
    }
  ]
}
```

**PostgreSQL 清理任务** (pg_cron):

```sql
-- 每小时清理过期 artifact
SELECT cron.schedule(
    'cleanup-expired-artifacts',
    '0 * * * *',
    $$
    DELETE FROM artifacts_metadata
    WHERE expires_at < NOW()
      AND is_pinned = FALSE
    $$
);

-- 每天清理孤立文件 (MinIO 有但 DB 无记录)
-- 通过对比 MinIO 列出文件与 DB 记录实现
```

### 6.3 用户交互

- **Pin 操作**: 用户可将任意 artifact 标记为"重要"（`is_pinned=true`），防止自动清理
- **归档时询问**: 会话归档/删除时，UI 弹出确认对话框："保留以下 artifact?"
- **批量管理**: 用户可在 Profile 页面查看和管理自己的所有 artifact

---

## 7. 性能优化

### 7.1 图片加载策略

```
首屏渲染:
  1. 优先加载 thumbnails (50-100 KB)
  2. 使用 <img loading="lazy"> 延迟加载非视口图片
  3. 缩略图使用 WebP/AVIF 格式

点击预览:
  1. 立即显示 thumbnail
  2. 后台预加载 medium (200-400 KB)
  3. 预加载完成后替换

完整尺寸:
  1. 用户主动请求时加载 originals
  2. 支持缩放/平移 (Pan/Zoom)
```

### 7.2 缓存策略

| 资源类型 | Browser Cache | CDN Cache | 策略 |
|---------|---------------|-----------|------|
| Thumbnails | 1 天 (ETag) | 7 天 | Cache-Control: public, max-age=86400 |
| Medium | 1 小时 | 7 天 | Cache-Control: public, max-age=3600 |
| Originals | 1 小时 | 30 天 | Cache-Control: private, max-age=3600 |
| HTML Reports | 5 分钟 | 1 天 | Cache-Control: public, max-age=300 |
| JSON Data | no-cache | 5 分钟 | Cache-Control: no-cache |

### 7.3 预取策略

```
预测用户行为 (基于当前会话):
  - 显示 thumbnails 时，后台预加载相邻图片的 medium 版本
  - 用户滚动到 report 末尾时，预取下一页 report 数据
  - Agent 正在处理时，显示 loading skeleton + 预加载已完成部分
```

### 7.4 Nginx 配置优化

```nginx
# 报告文件缓存
location /reports/ {
    alias /reports/;
    expires 1d;
    add_header Cache-Control "public, max-age=86400";
}

# CDN 回源 (生产环境)
location /cdn/ {
    proxy_pass http://minio:9000/fashion-artifacts/;
    proxy_cache_valid 200 7d;
    expires 7d;
    add_header Cache-Control "public";
}

# 缩略图专用路径
location /thumb/ {
    proxy_pass http://minio:9000/fashion-artifacts/images/thumbnails/;
    proxy_cache_valid 200 30d;
    expires 30d;
}
```

---

## 8. 迁移方案

### 8.1 从当前系统迁移

**阶段 1: 引入 MinIO (Week 1-2)**

```
1. 在 docker-compose.yml 添加 MinIO 服务
2. 创建 S3 bucket 结构
3. 实现 artifact_service.py 的 MinIO 集成
4. 新 artifact 自动写入 MinIO
5. 旧 artifact 保持 Docker Volume 访问
```

```yaml
# docker-compose.yml 新增
  minio:
    image: minio/minio:latest
    environment:
      MINIO_ROOT_USER: ${MINIO_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: ${MINIO_PASSWORD:-minioadmin}
    volumes:
      - miniodata:/data
    command: server /data --console-address ":9001"
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5
```

**阶段 2: 图片迁移 (Week 3-4)**

```
1. 开发迁移脚本: 将 Docker Volume 中的图片迁移至 MinIO
2. 更新 Qdrant image_url 指向 MinIO/CDN URL
3. 验证所有图片访问正常
4. 切换 Qdrant 写入路径至 MinIO
```

```python
# scripts/migrate-images-to-minio.py
import boto3
import shutil
from pathlib import Path

def migrate_images(volume_path: Path, bucket: str):
    s3 = boto3.client('s3', endpoint_url=settings.MINIO_ENDPOINT,
                      aws_access_key_id=settings.MINIO_ACCESS_KEY,
                      aws_secret_access_key=settings.MINIO_SECRET_KEY)

    for img_path in volume_path.rglob("*.jpg"):
        key = f"images/originals/{img_path.relative_to(volume_path)}"
        s3.upload_file(str(img_path), bucket, key)
        print(f"Migrated: {key}")
```

**阶段 3: 元数据迁移 (Week 5)**

```
1. 将现有 SQLite reports 表映射到 artifacts_metadata 表
2. 迁移 chat messages 中的 artifact 引用
3. 验证数据完整性
4. 下线 Docker Volume 旧路径
```

**阶段 4: CDN 接入 (Week 6)**

```
1. 配置 CDN (CloudFlare / 自建 nginx cache)
2. 更新 MinIO 公开访问策略
3. 所有 access_url 指向 CDN 域名
```

### 8.2 回滚计划

- 每个阶段完成后进行数据完整性校验
- MinIO 保留旧 Docker Volume 路径作为 fallback
- 数据库事务保证原子性

---

## 9. 实现优先级

| 阶段 | 功能 | 优先级 | 工作量 | 说明 |
|------|------|--------|--------|------|
| P0 | Artifact 元数据表 + CRUD API | P0 | 中 | 基础框架，PostgreSQL |
| P0 | 文件上传服务 (本地 FS) | P0 | 小 | 兼容当前 Docker Volume |
| P1 | MinIO 集成 | P1 | 中 | S3 兼容存储 |
| P1 | 生命周期清理任务 | P1 | 小 | pg_cron 定时任务 |
| P1 | 缩略图生成服务 | P1 | 中 | 图片处理 (Pillow) |
| P2 | CDN 接入 | P2 | 小 | nginx 配置 |
| P2 | 用户 Pin 功能 | P2 | 小 | 前端 + API 扩展 |
| P2 | 归档时 artifact 保留询问 | P2 | 小 | 前端 UI |

---

## 10. 关键文件清单

```
backend/app/
├── services/
│   ├── artifact_service.py      # 核心 artifact 业务逻辑 (新建)
│   └── image_processor.py      # 缩略图生成 (新建)
├── routers/
│   └── artifacts.py             # REST API 路由 (新建)
├── models/
│   └── artifact_models.py       # Pydantic schemas (新建)
├── repositories/
│   └── artifact_repository.py   # 数据库操作 (新建)
└── storage/
    ├── minio_client.py          # MinIO 封装 (新建)
    ├── local_storage.py         # 本地 FS 封装 (新建)
    └── storage_factory.py       # 存储后端工厂 (新建)

backend/scripts/
└── migrate-images-to-minio.py   # 数据迁移脚本 (新建)

frontend/src/
├── features/artifacts/
│   ├── artifact-api.ts          # API 客户端 (新建)
│   ├── artifact-store.ts        # 状态管理 (新建)
│   ├── artifact-card.tsx        # 展示组件 (新建)
│   └── artifact-manager.tsx     # 管理页面 (新建)
```

---

## 11. 风险与注意事项

1. **Qdrant image_url 兼容性**: 当前 image_url 指向外部 URL，迁移 MinIO 后需更新 Qdrant payload
2. **大文件上传**: 报告图片可能达 10-20 MB，需配置 nginx `client_max_body_size`
3. **SQLite vs PostgreSQL**: 当前 chat_sessions 用 PostgreSQL，user/subscriptions 用 SQLite。建议统一迁移至 PostgreSQL
4. **Docker Volume 持久性**: 当前 `reports:` volume 在单机 Docker Compose 环境可靠，迁移至 MinIO 后需考虑数据备份
5. **成本估算**: MinIO 单节点约 10-50 GB/天存储成本忽略不计

---

**设计完成，等待团队评审后进入实现阶段。**

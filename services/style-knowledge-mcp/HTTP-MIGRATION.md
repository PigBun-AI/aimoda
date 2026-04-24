# HTTP MCP 远程服务改造方案

## 背景

当前 style-knowledge-mcp 使用 **stdio 传输**，只能本地运行。需要改造为 **HTTP/SSE 远程 MCP 服务**，支持：

- 分布式 Agent 集群远程连接
- API Key 鉴权识别 Agent 身份和权限
- 独立部署（与 wwwd-reports 分开，避免工具描述占满 Agent 上下文）

## 目标架构

```
Agent A (风格采集)    ──HTTP──▶  style-knowledge-mcp (:18750)  ──▶  Qdrant
Agent B (报告生成)    ──HTTP──▶  wwwd-reports (:80/api/report-mcp)
Agent C (全流程)      ──HTTP──▶  两个 MCP 都连
```

**核心原则**：每个 MCP 服务是独立 HTTP 端点，Agent 按需订阅。避免所有工具塞进同一个 MCP 导致上下文膨胀。

---

## 改造范围

### 1. 传输层：stdio → HTTP/SSE

当前（`src/index.ts`）：
```typescript
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
const transport = new StdioServerTransport();
await server.connect(transport);
```

改造后：
```typescript
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

const app = express();
app.use(express.json());

// 鉴权中间件
app.use("/mcp", authMiddleware);

// MCP HTTP 端点
app.post("/mcp", async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(18750, () => {
  console.log("🎨 style-knowledge-mcp listening on :18750");
});
```

> **注意**：MCP SDK 的 HTTP 传输有两种：
> - `SSEServerTransport`（旧版，Server-Sent Events）
> - `StreamableHTTPServerTransport`（新版，推荐）
>
> 请检查 `@modelcontextprotocol/sdk` 当前版本支持哪种，优先用 Streamable HTTP。

### 2. 鉴权中间件

```typescript
// src/auth.ts
interface AgentIdentity {
  agent_id: string;
  name: string;
  permissions: ("read" | "write" | "delete")[];
}

const API_KEYS: Record<string, AgentIdentity> = {
  "sk-openclaw-001": {
    agent_id: "openclaw",
    name: "OpenClaw 风格采集 Agent",
    permissions: ["read", "write"],
  },
  "sk-vlm-pipeline": {
    agent_id: "vlm",
    name: "VLM 打标 Pipeline",
    permissions: ["read"],
  },
  "sk-admin": {
    agent_id: "admin",
    name: "管理员",
    permissions: ["read", "write", "delete"],
  },
};

function authMiddleware(req, res, next) {
  const apiKey = req.headers["x-api-key"] || req.headers["authorization"]?.replace("Bearer ", "");
  const identity = API_KEYS[apiKey];
  if (!identity) return res.status(401).json({ error: "Invalid API key" });
  req.agentIdentity = identity;
  next();
}
```

工具内部按权限控制：
- `search_style`, `get_style_detail`, `list_styles` → **read**
- `add_style`, `update_style`, `batch_import_styles` → **write**
- `delete_style` → **delete**

> **生产环境建议**：API Key 存数据库或环境变量，不硬编码。

### 3. 部署

#### Docker 容器（推荐）

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
EXPOSE 18750
CMD ["node", "dist/index.js"]
```

```yaml
# 加入 fashion-report 的 docker-compose.yml
style-knowledge-mcp:
  build: /path/to/aimoda-style-knowledge-mcp
  ports:
    - "18750:18750"
  environment:
    - QDRANT_URL=http://qdrant:6333
    - QDRANT_API_KEY=aimoda2025
    - FASHION_CLIP_ENDPOINT=http://113.108.13.218:34323
  restart: unless-stopped
```

#### Nginx 反代（可选，统一域名）

```nginx
# 在 fashion-report 的 nginx.conf 中添加
location /api/style-mcp {
    proxy_pass http://style-knowledge-mcp:18750/mcp;
    proxy_set_header X-API-Key $http_x_api_key;
}
```

这样 Agent 连接 `https://www-d.net/api/style-mcp` 即可。

### 4. Agent 端配置

各 Agent 的 `.mcp.json` 按需订阅：

```json
{
  "mcpServers": {
    "style-knowledge": {
      "type": "http",
      "url": "https://www-d.net/api/style-mcp",
      "headers": {
        "X-API-Key": "sk-openclaw-001"
      }
    }
  }
}
```

---

## 改造步骤

1. **安装依赖**：`npm install express` + 确认 MCP SDK 版本支持 HTTP 传输
2. **新建 `src/auth.ts`**：鉴权中间件 + 权限检查
3. **改造 `src/index.ts`**：stdio → HTTP/SSE 传输 + express 服务
4. **在各工具 handler 中加权限检查**：从 `extra` 参数获取 agent identity
5. **Dockerfile + docker-compose 部署配置**
6. **nginx 反代配置**（可选）
7. **测试**：用 curl 或 MCP Inspector 验证连接

## 依赖变更

```diff
 "dependencies": {
   "@modelcontextprotocol/sdk": "^1.12.1",
   "@qdrant/js-client-rest": "^1.13.0",
+  "express": "^5.1.0",
   "zod": "^3.25.11"
 }
```

## 注意事项

- **向后兼容**：可同时保留 stdio 模式，通过命令行参数 `--transport=http|stdio` 切换
- **CORS**：如果 Agent 从浏览器连接需配置 CORS
- **速率限制**：生产环境建议加 rate limiting 避免滥用
- **日志审计**：记录每个 Agent 的调用日志（who + when + which tool）

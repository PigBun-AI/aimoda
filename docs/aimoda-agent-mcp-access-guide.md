# Aimoda Agent MCP 接入指南

这份文档是给外部 Agent / 自动化客户端的最小接入说明。

目标：让外部 Agent 能直接调用 Aimoda 的检索会话工具，而不依赖内部 LangGraph thread 状态。

## 1. 接入入口

- 正式入口：
  - `https://ai-moda.ai/api/agent-mcp`
- 健康检查：
  - `https://ai-moda.ai/api/agent-mcp/health`

说明：

- `aimoda-agent-mcp` 不再直接暴露宿主机端口
- 必须通过 nginx 路由进入
- 当前 nginx 路由规则见：
  - `nginx.conf:111`
  - `docker-compose.yml:266`

如果部署环境沿用同样的 nginx 路由规则，则外部入口模式应为：

```text
<BASE_URL>/api/agent-mcp
```

当前建议直接使用统一域名：

```text
https://ai-moda.ai/api/agent-mcp
```

## 2. 鉴权方式

- 使用内部 Agent API Key
- Header：

```http
X-API-Key: sk-openclaw-001
```

也兼容：

```http
Authorization: Bearer sk-openclaw-001
```

不要使用用户登录 JWT，也不要依赖 LangGraph `thread_id`。

具体说明：

- 它就是现有内部 MCP 体系使用的 `sk-*` key
- 推荐与其他 MCP 统一复用
- 当前 `aimoda-agent-mcp` 适合作为内部自治 Agent 的检索 MCP，不要求用户登录态

## 3. 传输协议

- 协议：MCP over Streamable HTTP
- 交互方式：JSON-RPC 2.0
- 建议 Header：

```http
Content-Type: application/json
Accept: application/json, text/event-stream
```

标准初始化流程：

1. `initialize`
2. `notifications/initialized`
3. `tools/list`
4. `tools/call`

## 4. 当前可用工具

当前 `aimoda-agent-mcp` 暴露的 MCP 工具：

- `search_style`
- `start_collection`
- `add_filter`
- `remove_filter`
- `show_collection`
- `explore_colors`
- `analyze_trends`
- `get_image_details`

其中外部 Agent 最核心的 v1 检索会话链路是：

1. `start_collection`
2. `add_filter`
3. `remove_filter`
4. `show_collection`

## 5. 最重要的会话规则

外部 Agent 必须把 `retrieval_session_id` 当成一等对象。

- `start_collection`
  - 如果未传 `retrieval_session_id`，后端会创建新会话
  - 返回新的 `retrieval_session_id`
- `add_filter`
  - 必须传入 `retrieval_session_id`
- `remove_filter`
  - 必须传入 `retrieval_session_id`
- `show_collection`
  - 必须传入 `retrieval_session_id`

不要假设“当前连接只有一个 collection”。

正确理解是：

- 同一用户可以同时有多个 retrieval session
- 多个外部 Agent 可以并发调用
- 真正隔离 session 的字段是 `retrieval_session_id`

## 6. 最小 JSON-RPC 示例

### 6.1 initialize

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": {
      "name": "external-agent",
      "version": "1.0.0"
    }
  }
}
```

### 6.2 initialized notification

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/initialized",
  "params": {}
}
```

### 6.3 tools/list

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

### 6.4 start_collection

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "start_collection",
    "arguments": {
      "query": "老钱风 Max Mara 大衣"
    }
  }
}
```

典型返回中会包含：

- `retrieval_session_id`
- `total`
- `query`
- `filters_applied`

### 6.5 add_filter

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "add_filter",
    "arguments": {
      "retrieval_session_id": "<SESSION_ID>",
      "dimension": "brand",
      "value": "Max Mara"
    }
  }
}
```

### 6.6 show_collection

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "show_collection",
    "arguments": {
      "retrieval_session_id": "<SESSION_ID>"
    }
  }
}
```

## 7. curl 示例

```bash
BASE_URL="https://ai-moda.ai/api/agent-mcp"
API_KEY="sk-openclaw-001"

curl -sS "$BASE_URL" \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2025-03-26",
      "capabilities":{},
      "clientInfo":{"name":"external-agent","version":"1.0.0"}
    }
  }'
```

## 8. MCP Server 配置

如果外部 Agent 支持 `.mcp.json` / `mcpServers` 格式，可以直接这样配置：

```json
{
  "mcpServers": {
    "aimoda-agent": {
      "type": "http",
      "url": "https://ai-moda.ai/api/agent-mcp",
      "headers": {
        "X-API-Key": "sk-openclaw-001"
      }
    }
  }
}
```

如果客户端支持环境变量，推荐这样写：

```json
{
  "mcpServers": {
    "aimoda-agent": {
      "type": "http",
      "url": "https://ai-moda.ai/api/agent-mcp",
      "headers": {
        "X-API-Key": "${AIMODA_AGENT_MCP_API_KEY}"
      }
    }
  }
}
```

对应环境变量：

```bash
export AIMODA_AGENT_MCP_API_KEY="sk-openclaw-001"
```

如果外部 Agent 平台不支持 `headers` 字段，就需要在该平台自己的 MCP 配置界面里手动补充：

- `X-API-Key: sk-openclaw-001`

## 9. 推荐的 Agent 调用策略

- 先 `search_style`，再决定是否进入 `start_collection`
- 一旦开始检索，就保存 `retrieval_session_id`
- 后续过滤只针对该 session 做增删
- 完成收敛后用 `show_collection` 获取最终集合摘要
- 如果要并发跑多个检索主题，为每个主题维护独立的 `retrieval_session_id`

## 10. 给外部 Agent 的可复制说明

下面这段可以直接复制给其他 Agent：

```text
Aimoda MCP endpoint:
- url: https://ai-moda.ai/api/agent-mcp
- health: https://ai-moda.ai/api/agent-mcp/health

Auth:
- use internal MCP API key
- header: X-API-Key: sk-openclaw-001

MCP server config:
{
  "mcpServers": {
    "aimoda-agent": {
      "type": "http",
      "url": "https://ai-moda.ai/api/agent-mcp",
      "headers": {
        "X-API-Key": "sk-openclaw-001"
      }
    }
  }
}

Protocol:
- MCP over Streamable HTTP
- initialize -> notifications/initialized -> tools/list -> tools/call

Core tools:
- start_collection
- add_filter
- remove_filter
- show_collection

Important session rule:
- always persist and pass retrieval_session_id
- do not rely on thread_id
- do not assume there is only one active collection per connection

Recommended flow:
1. search_style
2. start_collection(query)
3. add_filter(retrieval_session_id, ...)
4. remove_filter(retrieval_session_id, ...) if needed
5. show_collection(retrieval_session_id)
```

## 11. 本地验证结论

当前本地已经验证通过：

- nginx 路由可用
- LangGraph ReAct agent 可以通过 nginx 转发后的 MCP 地址正常调用
- `start_collection / add_filter / show_collection` 链路可用
- 多 `retrieval_session_id` 并发不会串 session

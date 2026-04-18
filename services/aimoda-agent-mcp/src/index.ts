#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { CONFIG } from "./config.js";
import { authMiddleware, type AgentIdentity } from "./auth.js";

type JsonSchema = Record<string, any>;
type ToolSpec = {
  name: string;
  description: string;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  visibility: string;
  auth_scope: string;
  mutates: boolean;
};

type ToolListResponse = { success: boolean; tools: ToolSpec[] };

type ToolInvokeResponse = { success: boolean; result: unknown };

const args = process.argv.slice(2);
const transportArg = args.find((arg) => arg.startsWith("--transport="));
const transportMode = transportArg?.split("=")[1] ?? "http";

function textResult(data: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function internalHeaders(identity: AgentIdentity, extraHeaders: Record<string, string> = {}) {
  return {
    "X-Internal-Token": CONFIG.BACKEND_INTERNAL_TOKEN,
    "X-Internal-Service": CONFIG.SERVICE_NAME,
    "X-MCP-Agent-Id": identity.agent_id,
    "X-MCP-Agent-Name": identity.name,
    "X-MCP-Agent-Permissions": identity.permissions.join(","),
    ...extraHeaders,
  };
}

async function backendFetch<T>(path: string, identity: AgentIdentity, init?: RequestInit): Promise<T> {
  const response = await fetch(`${CONFIG.BACKEND_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...internalHeaders(identity, (init?.headers ?? {}) as Record<string, string>),
    },
  });
  const rawText = await response.text();
  let payload: unknown = rawText;
  try {
    payload = rawText ? JSON.parse(rawText) : null;
  } catch {
    payload = rawText;
  }
  if (!response.ok) {
    throw new Error(`Backend call failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }
  return payload as T;
}

function jsonSchemaToZodShape(schema: JsonSchema): Record<string, z.ZodTypeAny> {
  const props = schema?.properties ?? {};
  const required = new Set<string>(Array.isArray(schema?.required) ? schema.required : []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [key, value] of Object.entries(props)) {
    const zodValue = jsonSchemaToZod(value as JsonSchema);
    shape[key] = required.has(key) ? zodValue : zodValue.optional();
  }
  return shape;
}

function jsonSchemaToZod(schema: JsonSchema): z.ZodTypeAny {
  const rawType = schema?.type;
  const type = Array.isArray(rawType) ? rawType.filter((item) => item !== "null")[0] : rawType;
  switch (type) {
    case "string":
      return z.string();
    case "integer":
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(jsonSchemaToZod(schema?.items ?? { type: "string" }));
    case "object":
      return z.object(jsonSchemaToZodShape(schema));
    default:
      return z.any();
  }
}

async function loadToolSpecs(identity: AgentIdentity): Promise<ToolSpec[]> {
  const payload = await backendFetch<ToolListResponse>("/api/internal/agent-mcp/tools", identity, { method: "GET" });
  return Array.isArray(payload.tools) ? payload.tools : [];
}

async function invokeTool(toolName: string, identity: AgentIdentity, args: Record<string, unknown>) {
  const payload = await backendFetch<ToolInvokeResponse>(`/api/internal/agent-mcp/tools/${encodeURIComponent(toolName)}`, identity, {
    method: "POST",
    body: JSON.stringify(args ?? {}),
  });
  return payload.result;
}

async function createServer(identity: AgentIdentity): Promise<McpServer> {
  const server = new McpServer({
    name: "aimoda-agent-tools",
    version: "1.0.0",
  });

  const toolSpecs = await loadToolSpecs(identity);
  for (const spec of toolSpecs) {
    server.tool(
      spec.name,
      spec.description,
      jsonSchemaToZodShape(spec.input_schema),
      async (toolArgs) => {
        try {
          const result = await invokeTool(spec.name, identity, toolArgs as Record<string, unknown>);
          return textResult(result);
        } catch (error) {
          return textResult({ success: false, error: (error as Error).message, tool: spec.name }, true);
        }
      },
    );
  }

  return server;
}

async function main() {
  if (transportMode === "stdio") {
    throw new Error("aimoda-agent-mcp requires HTTP transport because it depends on API-key based internal agent auth.");
  }

  const express = await import("express");
  const app = express.default();
  app.use(express.default.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: CONFIG.SERVICE_NAME, version: "1.0.0" });
  });

  const handleMcp = async (req: any, res: any) => {
    const identity = (req as any).agentIdentity as AgentIdentity;
    const server = await createServer(identity);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  };

  app.post("/mcp", authMiddleware, handleMcp);
  app.get("/mcp", authMiddleware, handleMcp);
  app.delete("/mcp", authMiddleware, handleMcp);

  app.listen(CONFIG.PORT, "0.0.0.0", () => {
    console.log(`🤖 aimoda-agent-mcp HTTP server listening on :${CONFIG.PORT}`);
    console.log("   POST /mcp   — MCP endpoint (requires X-API-Key or Bearer sk-*)");
    console.log("   GET  /health — Health check");
  });
}

main().catch((err) => {
  console.error(`Fatal error: ${err}`);
  process.exit(1);
});

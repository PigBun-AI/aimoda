/**
 * API Key 鉴权 — 复用 style-knowledge-mcp 的模式
 */

import type { Request, Response, NextFunction } from "express";

export type Permission = "read" | "write" | "delete";

export interface AgentIdentity {
  agent_id: string;
  name: string;
  permissions: Permission[];
}

const API_KEYS: Record<string, AgentIdentity> = {
  "sk-openclaw-001": {
    agent_id: "openclaw",
    name: "OpenClaw 采集 Agent",
    permissions: ["read", "write", "delete"],
  },
  "sk-admin": {
    agent_id: "admin",
    name: "管理员",
    permissions: ["read", "write", "delete"],
  },
  "sk-fashion-report": {
    agent_id: "fashion-report",
    name: "Fashion Report 前端",
    permissions: ["read"],
  },
};

const TOOL_PERMISSIONS: Record<string, Permission> = {
  get_upload_spec: "read",
  create_gallery: "write",
  add_images: "write",
  list_galleries: "read",
  get_gallery: "read",
  update_gallery: "write",
  delete_gallery: "delete",
};

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const apiKey =
    (req.headers["x-api-key"] as string) ||
    (req.headers["authorization"] as string)?.replace("Bearer ", "");

  if (!apiKey) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const identity = API_KEYS[apiKey];
  if (!identity) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  (req as any).agentIdentity = identity;
  console.log(
    `[auth] ${identity.name} (${identity.agent_id}) → ${req.method} ${req.path}`,
  );
  next();
}

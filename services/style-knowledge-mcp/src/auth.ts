/**
 * API Key 鉴权模块
 *
 * 不同 Agent 拥有不同权限：
 *   - read: search_style, get_style_detail, list_styles
 *   - write: add_style, update_style, batch_import_styles
 *   - delete: delete_style
 */

import type { Request, Response, NextFunction } from "express";

export type Permission = "read" | "write" | "delete";

export interface AgentIdentity {
  agent_id: string;
  name: string;
  permissions: Permission[];
}

/**
 * API Key → Agent identity mapping.
 * Production: move to env vars or database.
 */
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
  "sk-fashion-report": {
    agent_id: "fashion-report",
    name: "Fashion Report Agent",
    permissions: ["read"],
  },
};

/**
 * Tool name → required permission mapping
 */
const TOOL_PERMISSIONS: Record<string, Permission> = {
  search_style: "read",
  get_style_detail: "read",
  list_styles: "read",
  list_style_gaps: "read",
  mark_style_gap_covered: "write",
  add_style: "write",
  update_style: "write",
  batch_import_styles: "write",
  delete_style: "delete",
};

/**
 * Extract API key from request headers.
 */
function extractApiKey(req: Request): string | undefined {
  return (
    (req.headers["x-api-key"] as string) ||
    (req.headers["authorization"] as string)?.replace("Bearer ", "")
  );
}

/**
 * Express middleware: validate API key and attach agent identity.
 */
export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    res.status(401).json({ error: "Missing API key" });
    return;
  }

  const identity = API_KEYS[apiKey];
  if (!identity) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }

  // Attach identity for downstream use
  (req as any).agentIdentity = identity;
  console.log(
    `[auth] ${identity.name} (${identity.agent_id}) → ${req.method} ${req.path}`,
  );
  next();
}

/**
 * Check if the calling agent has permission for a given tool.
 */
export function checkToolPermission(
  identity: AgentIdentity | undefined,
  toolName: string,
): { allowed: boolean; reason?: string } {
  if (!identity) {
    return { allowed: false, reason: "No agent identity" };
  }

  const required = TOOL_PERMISSIONS[toolName];
  if (!required) {
    // Unknown tool, allow by default
    return { allowed: true };
  }

  if (!identity.permissions.includes(required)) {
    return {
      allowed: false,
      reason: `Agent "${identity.name}" lacks "${required}" permission for tool "${toolName}"`,
    };
  }

  return { allowed: true };
}

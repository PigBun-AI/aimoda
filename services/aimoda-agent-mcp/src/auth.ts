import type { NextFunction, Request, Response } from "express";

export type Permission = "read" | "write" | "delete";

export interface AgentIdentity {
  agent_id: string;
  name: string;
  permissions: Permission[];
}

const API_KEYS: Record<string, AgentIdentity> = {
  "sk-openclaw-001": {
    agent_id: "openclaw",
    name: "OpenClaw Agent",
    permissions: ["read", "write"],
  },
  "sk-vlm-pipeline": {
    agent_id: "vlm",
    name: "VLM Pipeline",
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
    permissions: ["read", "write"],
  },
};

function extractApiKey(req: Request): string | undefined {
  return (
    (req.headers["x-api-key"] as string) ||
    (req.headers["authorization"] as string)?.replace("Bearer ", "")
  );
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
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

  (req as any).agentIdentity = identity satisfies AgentIdentity;
  next();
}

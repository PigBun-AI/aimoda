import type { Request, Response, NextFunction } from "express";

export interface AgentIdentity {
  agent_id: string;
  name: string;
  permissions: ("read" | "write" | "delete")[];
}

const API_KEYS: Record<string, AgentIdentity> = {
  "sk-openclaw-001": {
    agent_id: "openclaw",
    name: "OpenClaw Agent",
    permissions: ["read", "write"],
  },
  "sk-admin": {
    agent_id: "admin",
    name: "管理员",
    permissions: ["read", "write", "delete"],
  },
};

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey =
    (req.headers["x-api-key"] as string) ||
    (req.headers["authorization"] as string)?.replace("Bearer ", "");

  if (!apiKey) { res.status(401).json({ error: "Missing API key" }); return; }

  const identity = API_KEYS[apiKey];
  if (!identity) { res.status(401).json({ error: "Invalid API key" }); return; }

  (req as any).agentIdentity = identity;
  console.log(`[auth] ${identity.name} (${identity.agent_id}) → ${req.method} ${req.path}`);
  next();
}

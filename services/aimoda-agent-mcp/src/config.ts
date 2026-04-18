export const CONFIG = {
  PORT: parseInt(process.env.PORT ?? "18780", 10),
  BACKEND_URL: process.env.BACKEND_URL ?? "http://api:3000",
  BACKEND_INTERNAL_TOKEN: process.env.BACKEND_INTERNAL_TOKEN ?? "aimoda-agent-mcp-internal-token",
  SERVICE_NAME: process.env.BACKEND_INTERNAL_SERVICE_NAME ?? "aimoda-agent-mcp",
} as const;

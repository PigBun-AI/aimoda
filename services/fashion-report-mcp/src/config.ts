export const CONFIG = {
  PORT: parseInt(process.env.PORT ?? "18770", 10),
  // Backend API base URL (Docker internal network)
  BACKEND_URL: process.env.BACKEND_URL ?? "http://api:8000",
  BACKEND_INTERNAL_TOKEN: process.env.BACKEND_INTERNAL_TOKEN ?? "aimoda-report-mcp-internal-token",
  BACKEND_INTERNAL_SERVICE_NAME: process.env.BACKEND_INTERNAL_SERVICE_NAME ?? "fashion-report-mcp",
} as const;

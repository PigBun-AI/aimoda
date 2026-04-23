export const CONFIG = {
  PORT: parseInt(process.env.PORT ?? '18790', 10),
  BACKEND_URL: process.env.BACKEND_URL ?? 'http://api:3000',
  BACKEND_INTERNAL_TOKEN: process.env.BACKEND_INTERNAL_TOKEN ?? 'aimoda-trend-flow-mcp-internal-token',
  BACKEND_INTERNAL_SERVICE_NAME: process.env.BACKEND_INTERNAL_SERVICE_NAME ?? 'trend-flow-mcp',
} as const

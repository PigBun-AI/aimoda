export const CONFIG = {
  PORT: parseInt(process.env.PORT ?? "18770", 10),
  // Backend API base URL (Docker internal network)
  BACKEND_URL: process.env.BACKEND_URL ?? "http://api:8000",
} as const;

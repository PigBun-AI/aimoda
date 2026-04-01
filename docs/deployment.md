# Server Deployment

This project uses a single Docker Compose file plus two committed environment files:

- `env/server.dev.env`
- `env/server.prod.env`

Each environment is isolated by `COMPOSE_PROJECT_NAME`, Docker volumes, and a localhost-only HTTP port.

## Port layout

- `dev.ai-moda.ai` -> `127.0.0.1:38181`
- `ai-moda.ai` -> `127.0.0.1:38080`

The application stacks are not exposed publicly. Only the host-level Nginx listens on `80/443`.

## First-time server setup

1. Clone the repository onto the server.
2. Install Docker Engine and Docker Compose plugin.
3. Copy `deploy/nginx/ai-moda.ai.conf` into the host Nginx config directory.
4. Install Cloudflare Origin Certificates on the host:
   - `/etc/nginx/ssl/ai-moda.ai.pem`
   - `/etc/nginx/ssl/ai-moda.ai.key`
   - `/etc/nginx/ssl/dev.ai-moda.ai.pem`
   - `/etc/nginx/ssl/dev.ai-moda.ai.key`
5. Reload host Nginx.

## Manual deploy

```bash
./scripts/deploy-stack.sh dev
./scripts/deploy-stack.sh prod
```

## GitHub Actions secrets

Create these repository secrets before enabling the workflow:

- `PIXELSURGE_HOST`
- `PIXELSURGE_PORT`
- `PIXELSURGE_USER`
- `PIXELSURGE_SSH_KEY`
- `PIXELSURGE_DEPLOY_DIR_DEV`
- `PIXELSURGE_DEPLOY_DIR_PROD`

## Cloudflare

Use orange-cloud proxied DNS records for both domains and set SSL mode to `Full (strict)`.

## Current note

`services/style-knowledge-mcp` is still maintained as a nested Git repository in the local workspace, so the GitHub Actions rsync step currently excludes it and keeps the server-side copy in place.

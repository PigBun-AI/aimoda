# Server Deployment

This project uses a single Docker Compose file plus two environment entry points:

- `env/dev.env`
- `env/prod.env`

Checked-in templates live next to them:

- `env/dev.env.example`
- `env/prod.env.example`

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
cp env/dev.env.example env/dev.env
cp env/prod.env.example env/prod.env
./scripts/deploy-stack.sh dev
./scripts/deploy-stack.sh prod
```

For local use, keep the same env semantics:

```bash
docker compose --env-file env/dev.env -p aimoda-dev up -d --build
docker compose --env-file env/prod.env -p aimoda-prod up -d --build
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

## Build behavior

The MCP services are built from source inside Docker during deployment, so the server does not rely on pre-built local `dist/` artifacts or local `node_modules/`.

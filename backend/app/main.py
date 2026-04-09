from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from .config import settings
from .database import initialize_database
from .exceptions import AppError
from .postgres import close_pg_pool
from .routers import auth, users, reports, admin, redemption_codes, mcp, chat, oss, galleries, report_mcp_internal, favorites
from .services.favorite_upload_job_service import recover_favorite_upload_jobs
from .services.oss_service import get_oss_service
from .services.report_upload_job_service import recover_report_upload_jobs

PG_REPORT_SCHEMA_LOCK_KEY = 4201001
PG_CHAT_SCHEMA_LOCK_KEY = 4201002


def _init_pg_report_schema():
    """Initialize PostgreSQL report tables (idempotent)."""
    import psycopg
    from pathlib import Path
    sql_path = Path(__file__).parent / "sql" / "report_schema.sql"
    if not sql_path.exists():
        return
    schema = sql_path.read_text(encoding="utf-8")
    try:
        with psycopg.connect(settings.POSTGRES_DSN) as conn:
            conn.execute("SELECT pg_advisory_lock(%s)", (PG_REPORT_SCHEMA_LOCK_KEY,))
            conn.execute(schema)
            conn.commit()
            conn.execute("SELECT pg_advisory_unlock(%s)", (PG_REPORT_SCHEMA_LOCK_KEY,))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Failed to init PG report schema: %s", e)


def _init_pg_chat_schema():
    """Initialize PostgreSQL chat tables (idempotent)."""
    import psycopg
    from pathlib import Path
    sql_path = Path(__file__).parent / "sql" / "chat_schema.sql"
    if not sql_path.exists():
        return
    schema = sql_path.read_text(encoding="utf-8")
    try:
        with psycopg.connect(settings.POSTGRES_DSN) as conn:
            conn.execute("SELECT pg_advisory_lock(%s)", (PG_CHAT_SCHEMA_LOCK_KEY,))
            conn.execute(schema)
            conn.execute("""
                ALTER TABLE IF EXISTS artifacts
                DROP CONSTRAINT IF EXISTS artifacts_artifact_type_check
            """)
            conn.execute("""
                ALTER TABLE IF EXISTS artifacts
                ADD CONSTRAINT artifacts_artifact_type_check
                CHECK (artifact_type IN (
                    'image', 'report', 'table', 'code', 'color_analysis',
                    'trend_chart', 'collection_result', 'bundle_result', 'vision_analysis', 'other'
                ))
            """)
            conn.commit()
            conn.execute("SELECT pg_advisory_unlock(%s)", (PG_CHAT_SCHEMA_LOCK_KEY,))
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning("Failed to init PG chat schema: %s", e)
        try:
            with psycopg.connect(settings.POSTGRES_DSN) as conn:
                conn.execute("""
                    ALTER TABLE IF EXISTS artifacts
                    DROP CONSTRAINT IF EXISTS artifacts_artifact_type_check
                """)
                conn.execute("""
                    ALTER TABLE IF EXISTS artifacts
                    ADD CONSTRAINT artifacts_artifact_type_check
                    CHECK (artifact_type IN (
                        'image', 'report', 'table', 'code', 'color_analysis',
                        'trend_chart', 'collection_result', 'bundle_result', 'vision_analysis', 'other'
                    ))
                """)
                conn.commit()
        except Exception as repair_error:
            logging.getLogger(__name__).warning(
                "Failed to repair artifact_type constraint: %s",
                repair_error,
            )


def _recover_report_upload_jobs():
    """Fail stale in-flight upload jobs left behind by restarts."""
    import logging

    try:
        recovered = recover_report_upload_jobs()
        if recovered:
            logging.getLogger(__name__).warning(
                "Marked %d stale report upload jobs as failed during startup",
                recovered,
            )
    except Exception as e:
        logging.getLogger(__name__).warning("Failed to recover report upload jobs: %s", e)


def _recover_favorite_upload_jobs():
    """Fail stale in-flight favorite upload jobs left behind by restarts."""
    import logging

    try:
        recovered = recover_favorite_upload_jobs()
        if recovered:
            logging.getLogger(__name__).warning(
                "Marked %d stale favorite upload jobs as failed during startup",
                recovered,
            )
    except Exception as e:
        logging.getLogger(__name__).warning("Failed to recover favorite upload jobs: %s", e)


def _ensure_oss_direct_upload_cors():
    """Ensure the OSS bucket is ready for browser direct uploads."""
    import logging

    try:
        updated = get_oss_service().ensure_direct_upload_cors()
        if updated:
            logging.getLogger(__name__).warning(
                "Applied OSS CORS configuration for browser direct uploads",
            )
    except Exception as e:
        logging.getLogger(__name__).warning("Failed to ensure OSS direct upload CORS: %s", e)


def _init_pg_gallery_indexes():
    """Ensure read-path indexes exist for inspiration gallery tables.

    Gallery tables are owned by the gallery MCP, but the app depends on them for
    public pagination and detail views. We enforce the indexes here so deploys
    stay fast even if upstream schema creation omitted them.
    """
    import logging
    import psycopg

    try:
        with psycopg.connect(settings.POSTGRES_DSN) as conn:
            galleries_exists = conn.execute(
                "SELECT to_regclass('public.galleries') IS NOT NULL"
            ).fetchone()[0]
            gallery_images_exists = conn.execute(
                "SELECT to_regclass('public.gallery_images') IS NOT NULL"
            ).fetchone()[0]

            if galleries_exists:
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_galleries_status_created_id ON galleries(status, created_at DESC, id DESC)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_galleries_status_category_created_id ON galleries(status, category, created_at DESC, id DESC)"
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_galleries_tags_gin ON galleries USING GIN(tags)"
                )

            if gallery_images_exists:
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_gallery_images_gallery_sort_created ON gallery_images(gallery_id, sort_order, created_at)"
                )

            conn.commit()
    except Exception as e:
        logging.getLogger(__name__).warning("Failed to init PG gallery indexes: %s", e)


def get_real_ip(request: Request) -> str:
    """Get real IP supporting Cloudflare proxy."""
    cf_ip = request.headers.get("cf-connecting-ip")
    if cf_ip:
        return cf_ip
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


limiter = Limiter(key_func=get_real_ip)

# Initialize databases on startup
initialize_database()    # SQLite (users, sessions, subscriptions, etc.)
_init_pg_report_schema() # PostgreSQL (reports, report_views)
_init_pg_chat_schema()   # PostgreSQL (chat_sessions, messages, artifacts)
_init_pg_gallery_indexes() # PostgreSQL gallery read-path indexes
_recover_report_upload_jobs()
_recover_favorite_upload_jobs()
_ensure_oss_direct_upload_cors()

app = FastAPI(title="Fashion Report API", version="1.0.0")
app.state.limiter = limiter


@app.on_event("shutdown")
def _shutdown_resources():
    close_pg_pool()


# --- CORS ---
# MCP endpoints allow any origin, others restricted to FRONTEND_URL
@app.middleware("http")
async def cors_middleware(request: Request, call_next):
    is_mcp = request.url.path.startswith("/api/mcp")
    is_dev = request.url.path.startswith("/api/dev")
    origin = "*" if (is_mcp or is_dev) else settings.FRONTEND_URL

    if request.method == "OPTIONS":
        response = JSONResponse(content="", status_code=204)
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return response

    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response


# --- Error Handlers ---
@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError):
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": exc.message},
    )


@app.exception_handler(ValidationError)
async def validation_error_handler(request: Request, exc: ValidationError):
    return JSONResponse(
        status_code=400,
        content={"success": False, "error": "请求参数校验失败", "details": exc.errors()},
    )


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"success": False, "error": "请求过于频繁，请稍后重试"},
    )


@app.exception_handler(Exception)
async def general_error_handler(request: Request, exc: Exception):
    # Known business error keywords
    business_keywords = ["已存在", "缺少", "无法", "非法路径", "必需文件", "格式不正确", "无效", "不支持", "超过", "限制"]
    is_business = any(kw in str(exc) for kw in business_keywords)
    status_code = 400 if is_business else 500

    is_dev = settings.ENV != "production"
    message = str(exc) if (status_code != 500 or is_dev) else "服务器内部错误"

    return JSONResponse(
        status_code=status_code,
        content={"success": False, "error": message},
    )


# --- Health Check ---
@app.get("/api/health")
def health():
    return {"success": True, "data": {"status": "ok"}}


# --- Mount Routers ---
app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(reports.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(redemption_codes.admin_router, prefix="/api")
app.include_router(redemption_codes.user_router, prefix="/api")
app.include_router(mcp.router, prefix="/api")
app.include_router(report_mcp_internal.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(favorites.router, prefix="/api")
app.include_router(oss.router, prefix="/api")
app.include_router(galleries.router, prefix="/api")

# Dev-only router (no auth) — only in non-production
if settings.ENV != "production":
    from .routers import dev
    app.include_router(dev.router, prefix="/api")

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
from .routers import auth, users, reports, admin, redemption_codes, mcp, chat, oss


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

# Initialize database on startup
initialize_database()

app = FastAPI(title="Fashion Report API", version="1.0.0")
app.state.limiter = limiter


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
app.include_router(chat.router, prefix="/api")
app.include_router(oss.router, prefix="/api")

# Dev-only router (no auth) — only in non-production
if settings.ENV != "production":
    from .routers import dev
    app.include_router(dev.router, prefix="/api")

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from ..config import settings

router = APIRouter(prefix="/mcp", tags=["mcp"])


def _report_mcp_url() -> str:
    base = (settings.SERVER_URL or settings.FRONTEND_URL or "https://ai-moda.ai").rstrip("/")
    return f"{base}/api/report-mcp"


def _deprecated_payload(path: str) -> dict:
    return {
        "success": False,
        "error": "Deprecated endpoint",
        "message": (
            "Legacy /api/mcp report endpoints have been disabled. "
            f"Use the standalone fashion report MCP endpoint instead: {_report_mcp_url()}"
        ),
        "path": path,
        "replacement": _report_mcp_url(),
    }


@router.api_route("", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def mcp_disabled(request: Request):
    return JSONResponse(status_code=410, content=_deprecated_payload("/api/mcp"))


@router.api_route("/upload", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def mcp_upload_disabled(request: Request):
    return JSONResponse(status_code=410, content=_deprecated_payload("/api/mcp/upload"))

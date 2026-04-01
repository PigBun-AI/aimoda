import json
import math
import tempfile
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, Request

from ..config import settings
from ..services.report_service import get_reports, upload_report_archive
from ..repositories.report_repo import find_report_by_slug

# skills 目录
SKILLS_DIR = Path(__file__).parent.parent.parent / "skills"


def _get_report_spec_skill() -> str:
    skill_path = SKILLS_DIR / "wwwd-report-spec" / "SKILL.md"
    return skill_path.read_text(encoding="utf-8")


router = APIRouter(prefix="/mcp", tags=["mcp"])


@router.post("")
async def mcp_jsonrpc(request: Request):
    """MCP JSON-RPC 2.0 endpoint."""
    body = await request.json()

    # Validate JSON-RPC 2.0
    if body.get("jsonrpc") != "2.0":
        return {
            "jsonrpc": "2.0",
            "id": body.get("id", 0),
            "error": {"code": -32600, "message": 'Invalid Request: jsonrpc version must be "2.0"'},
        }

    req_id = body.get("id", 0)
    method = body.get("method", "")
    params = body.get("params", {})

    try:
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "wwwd-mcp-server", "version": "1.0.0"},
                },
            }

        if method == "tools/list":
            tools = [
                {
                    "name": "get_report_spec",
                    "description": "获取最新报告文件夹层级、iframe 解析规则、命名规范和元数据规则。Agent 在生成报告前应先查阅此规范。",
                    "inputSchema": {"type": "object", "properties": {}, "required": []},
                },
                {
                    "name": "upload_report",
                    "description": "上传报告压缩包（zip）到 WWWD 平台。使用 multipart/form-data POST 到返回的 URL。",
                    "inputSchema": {"type": "object", "properties": {}, "required": []},
                },
                {
                    "name": "list_reports",
                    "description": "查询平台上已发布的报告列表。可通过 slug 精确查找单篇报告（用于上传后验证）。",
                    "inputSchema": {
                        "type": "object",
                        "properties": {
                            "slug": {
                                "type": "string",
                                "description": '按 slug 精确查找（如 zimmermann-fall-2026）。省略则返回全部报告列表。',
                            },
                            "page": {"type": "number", "description": "页码，默认 1"},
                            "limit": {"type": "number", "description": "每页条数，默认 20"},
                        },
                        "required": [],
                    },
                },
            ]
            return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": tools}}

        if method == "tools/call":
            tool_name = params.get("name")
            tool_args = params.get("arguments", {})

            if not tool_name:
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32602, "message": "Missing tool name"},
                }

            if tool_name == "get_report_spec":
                skill_content = _get_report_spec_skill()
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": skill_content}]},
                }

            if tool_name == "upload_report":
                server_url = settings.SERVER_URL or "http://localhost:38180"
                payload = {
                    "uploadUrl": f"{server_url}/api/mcp/upload",
                    "method": "POST",
                    "contentType": "multipart/form-data",
                    "fields": {
                        "file": "(二进制文件，必需)",
                        "uploadedBy": "(用户ID，可选，默认1)",
                    },
                }
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]},
                }

            if tool_name == "list_reports":
                slug = tool_args.get("slug")

                def _sanitize(r):
                    return {
                        "id": r.id,
                        "slug": r.slug,
                        "title": r.title,
                        "brand": r.brand,
                        "season": r.season,
                        "year": r.year,
                        "lookCount": r.look_count,
                        "indexUrl": r.index_url,
                        "overviewUrl": r.overview_url,
                        "coverUrl": r.cover_url,
                        "createdAt": r.created_at,
                        "updatedAt": r.updated_at,
                    }

                if slug:
                    report = find_report_by_slug(slug)
                    payload = (
                        {"found": True, "report": _sanitize(report)}
                        if report
                        else {"found": False, "slug": slug, "message": f'未找到 slug 为 "{slug}" 的报告'}
                    )
                    return {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]},
                    }

                page = int(tool_args.get("page", 1))
                limit = int(tool_args.get("limit", 20))
                reports, total = get_reports(page, limit)
                payload = {
                    "reports": [_sanitize(r) for r in reports],
                    "pagination": {
                        "page": page,
                        "limit": limit,
                        "total": total,
                        "totalPages": math.ceil(total / limit) if limit else 0,
                    },
                }
                return {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {"content": [{"type": "text", "text": json.dumps(payload, indent=2)}]},
                }

            return {
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Tool not found: {tool_name}"},
            }

        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }

    except Exception as e:
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32000, "message": str(e)},
        }


@router.post("/upload", status_code=201)
async def mcp_upload(file: UploadFile = File(...), uploadedBy: int = 1):
    """Direct file upload endpoint for MCP."""
    if not file.filename:
        return {"success": False, "error": "未提供上传文件"}

    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    report = upload_report_archive(archive_path=tmp_path, uploaded_by=uploadedBy)

    return {
        "success": True,
        "message": "报告上传成功",
        "report": {
            "id": report.id,
            "slug": report.slug,
            "title": report.title,
            "brand": report.brand,
            "season": f"{report.season} {report.year}",
            "lookCount": report.look_count,
            "indexUrl": report.index_url,
            "overviewUrl": report.overview_url,
            "coverUrl": report.cover_url,
        },
    }

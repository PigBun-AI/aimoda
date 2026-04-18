from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Header

from ..agent.tool_registry import ToolActor, ToolExecutionContext, execute_registered_tool, get_tool_spec, list_tool_specs
from ..dependencies import require_agent_mcp_internal_service
from ..exceptions import AppError
from ..services.retrieval_session_engine import RetrievalSessionEngineError

router = APIRouter(
    prefix="/internal/agent-mcp",
    tags=["agent-mcp-internal"],
    include_in_schema=False,
)


@router.get("/tools")
def list_agent_mcp_tools(
    caller: Annotated[dict[str, Any], Depends(require_agent_mcp_internal_service)],
):
    return {
        "success": True,
        "tools": [
            {
                "name": spec.name,
                "description": spec.description,
                "input_schema": spec.input_schema,
                "output_schema": spec.output_schema,
                "visibility": spec.visibility,
                "auth_scope": spec.auth_scope,
                "mutates": spec.mutates,
            }
            for spec in list_tool_specs(visibility="mcp")
        ],
        "agent": {
            "id": caller["agent_id"],
            "name": caller["agent_name"],
            "permissions": caller["permissions"],
        },
    }


@router.post("/tools/{tool_name}")
def execute_agent_mcp_tool(
    tool_name: str,
    payload: Annotated[dict[str, Any], Body(default_factory=dict)],
    caller: Annotated[dict[str, Any], Depends(require_agent_mcp_internal_service)],
):
    try:
        spec = get_tool_spec(tool_name)
    except KeyError as exc:
        raise AppError(str(exc), 404) from exc

    if spec.visibility not in {"mcp", "both"}:
        raise AppError(f"Tool '{tool_name}' is not exposed over MCP.", 404)

    ctx = ToolExecutionContext(
        actor=ToolActor(
            agent_id=caller["agent_id"],
            agent_name=caller["agent_name"],
            permissions=list(caller["permissions"]),
            role="agent",
        ),
        source="mcp",
    )

    try:
        result = execute_registered_tool(tool_name, ctx, dict(payload or {}))
    except RetrievalSessionEngineError as exc:
        raise AppError(exc.message, exc.status_code) from exc

    return {
        "success": True,
        "tool": tool_name,
        "result": result.payload,
    }

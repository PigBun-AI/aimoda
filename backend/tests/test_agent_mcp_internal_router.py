from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routers import agent_mcp_internal


def test_list_agent_mcp_tools(monkeypatch):
    app = FastAPI()
    app.include_router(agent_mcp_internal.router, prefix="/api")
    app.dependency_overrides[agent_mcp_internal.require_agent_mcp_internal_service] = lambda: {
        "service_name": "aimoda-agent-mcp",
        "agent_id": "openclaw",
        "agent_name": "OpenClaw Agent",
        "permissions": ["read", "write"],
    }
    client = TestClient(app)

    response = client.get("/api/internal/agent-mcp/tools")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    tool_names = {tool["name"] for tool in payload["tools"]}
    assert {
        "search_style",
        "start_collection",
        "add_filter",
        "remove_filter",
        "show_collection",
        "explore_colors",
        "analyze_trends",
        "get_image_details",
    }.issubset(tool_names)
    assert "fashion_vision" not in tool_names
    assert "peek_collection" not in tool_names
    assert payload["agent"]["id"] == "openclaw"


def test_execute_agent_mcp_tool(monkeypatch):
    app = FastAPI()
    app.include_router(agent_mcp_internal.router, prefix="/api")
    app.dependency_overrides[agent_mcp_internal.require_agent_mcp_internal_service] = lambda: {
        "service_name": "aimoda-agent-mcp",
        "agent_id": "fashion-report",
        "agent_name": "Fashion Report Agent",
        "permissions": ["read", "write"],
    }
    monkeypatch.setattr(
        agent_mcp_internal,
        "execute_registered_tool",
        lambda tool_name, ctx, payload: type("Result", (), {"payload": {"retrieval_session_id": "retrieval-88", "action": tool_name, "echo": payload}})(),
    )

    client = TestClient(app)
    response = client.post(
        "/api/internal/agent-mcp/tools/add_filter",
        json={"retrieval_session_id": "retrieval-88", "dimension": "brand", "value": "the row"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["tool"] == "add_filter"
    assert payload["result"]["retrieval_session_id"] == "retrieval-88"

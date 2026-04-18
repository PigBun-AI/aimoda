from backend.app.agent.tool_registry import list_tool_specs
from backend.app.agent.tools import ALL_TOOLS


def _tool_name(tool_obj) -> str:
    return getattr(tool_obj, "name", getattr(getattr(tool_obj, "func", None), "__name__", ""))


def test_langgraph_all_tools_are_built_from_internal_registry_order():
    registry_names = [spec.name for spec in list_tool_specs(visibility="internal")]
    all_tool_names = [_tool_name(tool_obj) for tool_obj in ALL_TOOLS]

    assert all_tool_names == registry_names


def test_mcp_registry_excludes_internal_only_tools():
    mcp_names = {spec.name for spec in list_tool_specs(visibility="mcp")}

    assert "fashion_vision" not in mcp_names
    assert "peek_collection" not in mcp_names
    assert {"search_style", "start_collection", "show_collection", "analyze_trends"}.issubset(mcp_names)

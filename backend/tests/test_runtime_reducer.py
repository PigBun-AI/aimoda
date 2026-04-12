from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agent.runtime_reducer import (
    format_execution_state,
    merge_execution_state,
    reduce_tool_result_blocks,
)


def test_reduce_tool_result_blocks_compacts_multistep_flow():
    blocks = [
        {"type": "tool_use", "id": "tool-1", "name": "fashion_vision", "input": {}},
        {
            "type": "tool_result",
            "tool_use_id": "tool-1",
            "content": '{"ok":true,"recommended_next_step":"start_collection","vision_primary_category":"jacket","analysis":{"summary_zh":"黑色利落夹克","retrieval_query_en":"structured black tailored jacket"}}',
        },
        {"type": "tool_use", "id": "tool-2", "name": "start_collection", "input": {}},
        {
            "type": "tool_result",
            "tool_use_id": "tool-2",
            "content": '{"status":"collection_started","query":"structured black tailored jacket","total":18,"seeded_filters":["category=jacket"],"recommended_next_step":"add_filter","message":"Collection started."}',
        },
        {"type": "tool_use", "id": "tool-3", "name": "show_collection", "input": {}},
        {
            "type": "tool_result",
            "tool_use_id": "tool-3",
            "content": '{"action":"show_collection","query":"structured black tailored jacket","total":18,"filters_applied":["category=jacket"],"search_request_id":"artifact-1","recommended_next_step":"done","message":"Showing results."}',
        },
    ]

    state = reduce_tool_result_blocks(blocks)

    assert state["latest_tool"] == "show_collection"
    assert state["current_stage"] == "ready_to_present"
    assert state["recommended_next_step"] == "done"
    assert state["vision"]["primary_category"] == "jacket"
    assert state["active_collection"]["search_request_id"] == "artifact-1"


def test_merge_execution_state_preserves_previous_sections():
    previous = {
        "vision": {"retrieval_query": "minimal black jacket", "primary_category": "jacket"},
        "current_stage": "ready_to_start_collection",
    }
    patch = {
        "active_collection": {"query": "minimal black jacket", "total": 11},
        "current_stage": "collection_active",
    }

    merged = merge_execution_state(previous, patch)

    assert merged["vision"]["primary_category"] == "jacket"
    assert merged["active_collection"]["total"] == 11
    assert merged["current_stage"] == "collection_active"


def test_format_execution_state_emits_compact_prompt_block():
    text = format_execution_state({
        "current_stage": "collection_active",
        "latest_tool": "add_filter",
        "active_collection": {"query": "minimal coat", "total": 9, "filters_applied": ["category=coat"]},
    })

    assert "[EXECUTION_STATE]" in text
    assert "current_stage=collection_active" in text
    assert "active_collection.query=minimal coat" in text

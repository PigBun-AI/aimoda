from backend.app.routers import chat as chat_router
from backend.app.services import chat_service as service


def test_derive_session_title_from_blocks_prefers_text():
    title = service.derive_session_title_from_blocks([
        {"type": "text", "text": "  蓝色的连衣裙，优雅通勤一点  "},
        {"type": "image", "source": {"type": "url", "url": "https://example.com/look.jpg"}},
    ])

    assert title == "蓝色的连衣裙，优雅通勤一点"


def test_derive_session_title_from_blocks_strips_greetings():
    title = service.derive_session_title_from_blocks([
        {"type": "text", "text": "你好，请帮我找一些极简风格的白色衬衫"},
    ])

    assert title == "一些极简风格的白色衬衫"


def test_derive_session_title_from_blocks_supports_image_only():
    title = service.derive_session_title_from_blocks([
        {"type": "image", "source": {"type": "url", "url": "https://example.com/look.jpg"}},
    ])

    assert title == service.IMAGE_SEARCH_SESSION_TITLE


def test_derive_session_title_from_turn_uses_style_tool_result():
    title = service.derive_session_title_from_turn(
        [{"type": "text", "text": "你好，帮我分析一下这个风格"}],
        [{
            "type": "tool_result",
            "tool_use_id": "tool-1",
            "content": '{"primary_style":{"style_name":"Swiss Negative"}}',
        }],
    )

    assert title == "Swiss Negative风格解析"


def test_sanitize_generated_title_strips_think_blocks():
    title = service._sanitize_generated_title("<think>先分析用户意图</think> 红色连衣裙检索")

    assert title == "红色连衣裙检索"


def test_derive_session_title_from_blocks_supports_multi_image_only():
    title = service.derive_session_title_from_blocks([
        {"type": "image", "source": {"type": "url", "url": "https://example.com/look-1.jpg"}},
        {"type": "image", "source": {"type": "url", "url": "https://example.com/look-2.jpg"}},
    ])

    assert title == service.IMAGE_SEARCH_SESSION_TITLE


def test_build_runtime_thread_id_includes_version():
    assert service.build_runtime_thread_id(7, "session-123", 3) == "7:session-123:v3"


def test_merge_session_state_tracks_current_and_last_run_id():
    running = service._merge_session_state(
        {},
        execution_status="running",
        run_id="run-123",
    )

    runtime_running = running["runtime"]
    assert runtime_running["execution_status"] == "running"
    assert runtime_running["current_run_id"] == "run-123"
    assert runtime_running["last_run_id"] == "run-123"

    completed = service._merge_session_state(
        running,
        execution_status="completed",
        run_id="run-123",
    )

    runtime_completed = completed["runtime"]
    assert runtime_completed["execution_status"] == "completed"
    assert runtime_completed["current_run_id"] is None
    assert runtime_completed["last_run_id"] == "run-123"


def test_maybe_compact_session_rolls_thread_version(monkeypatch):
    captured = {}

    monkeypatch.setattr(service, "get_session", lambda session_id: {
        "id": session_id,
        "title": "蓝色裙子",
        "message_count": 20,
        "model_config": {"runtime": {"compaction": {"thread_version": 2, "compacted_message_count": 0}}},
    })
    monkeypatch.setattr(service, "get_session_agent_runtime", lambda session_id: {
        "search_session": {
            "query": "blue dress",
            "filters": [{"type": "category", "value": "dress"}],
        },
        "semantics": {"primary_style_name": "minimal romantic"},
    })
    monkeypatch.setattr(service, "list_messages", lambda session_id, user_id, limit, offset, include_system=False: [
        {"role": "user", "content": [{"type": "text", "text": "找蓝色连衣裙"}]},
        {"role": "assistant", "content": [{"type": "text", "text": "先从极简浪漫风开始"}]},
    ] * 10)
    monkeypatch.setattr(service, "save_context_summary", lambda **kwargs: {
        "version": 4,
        "range_end": kwargs["range_end"],
        "summary": kwargs["summary"],
    })

    def _fake_apply(session_id, **kwargs):
        captured["session_id"] = session_id
        captured.update(kwargs)

    monkeypatch.setattr(service, "_apply_compaction_state_update", _fake_apply)

    result = service.maybe_compact_session("session-1", 99)

    assert result["thread_version"] == 3
    assert result["summary_version"] == 4
    assert captured["thread_version"] == 3
    assert captured["active_summary_version"] == 4
    assert captured["pending_bootstrap_thread_version"] == 3


def test_get_compaction_bootstrap_payload_returns_recent_messages(monkeypatch):
    monkeypatch.setattr(service, "get_session", lambda session_id: {
        "id": session_id,
        "message_count": 8,
        "model_config": {
            "runtime": {
                "compaction": {
                    "thread_version": 2,
                    "active_summary_version": 3,
                    "compacted_message_count": 6,
                    "pending_bootstrap_thread_version": 2,
                }
            }
        },
    })
    monkeypatch.setattr(service, "get_latest_summary", lambda session_id: {
        "version": 3,
        "summary": "older summary",
        "range_end": 6,
    })
    monkeypatch.setattr(service, "get_summary_by_version", lambda session_id, version: {
        "version": version,
        "summary": "older summary",
        "range_end": 6,
    })
    monkeypatch.setattr(service, "list_messages", lambda session_id, user_id, limit, offset, include_system=False: [
        {"role": "user", "content": [{"type": "text", "text": f"m{i}"}]}
        for i in range(1, 9)
    ])

    payload = service.get_compaction_bootstrap_payload("session-1", 7, thread_version=2)

    assert payload["summary"]["summary"] == "older summary"
    assert len(payload["recent_messages"]) == 2
    assert payload["recent_messages"][0]["content"][0]["text"] == "m7"


def test_format_compaction_bootstrap_summarizes_tool_only_recent_messages():
    bootstrap = {
        "summary": {"summary": "older summary"},
        "recent_messages": [
            {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": "tool-1",
                        "content": (
                            '{"action":"show_collection","total":32,'
                            '"filters_applied":["category=dress","color=blue"]}'
                        ),
                    }
                ],
            }
        ],
    }

    formatted = chat_router._format_compaction_bootstrap(bootstrap)

    assert "older summary" in formatted
    assert "展示检索结果 32 张" in formatted

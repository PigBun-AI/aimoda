from backend.app.services import chat_service


def test_merge_session_state_tracks_stopping_as_first_class_status():
    running = chat_service._merge_session_state(
        {},
        execution_status="running",
        run_id="run-1",
    )
    stopping = chat_service._merge_session_state(
        running,
        execution_status="stopping",
        run_id="run-1",
    )
    completed = chat_service._merge_session_state(
        stopping,
        execution_status="completed",
        run_id="run-1",
    )

    running_runtime = running["runtime"]
    assert running_runtime["execution_status"] == "running"
    assert running_runtime["current_run_id"] == "run-1"
    assert running_runtime["stop_requested_at"] is None
    assert running_runtime["last_run_completed_at"] is None

    stopping_runtime = stopping["runtime"]
    assert stopping_runtime["execution_status"] == "stopping"
    assert stopping_runtime["current_run_id"] == "run-1"
    assert stopping_runtime["last_run_id"] == "run-1"
    assert stopping_runtime["stop_requested_at"] is not None
    assert stopping_runtime["last_run_completed_at"] is None

    completed_runtime = completed["runtime"]
    assert completed_runtime["execution_status"] == "completed"
    assert completed_runtime["current_run_id"] is None
    assert completed_runtime["last_run_id"] == "run-1"
    assert completed_runtime["stop_requested_at"] is None
    assert completed_runtime["last_run_completed_at"] is not None


def test_merge_session_state_resets_stop_metadata_for_idle_status():
    stopping = chat_service._merge_session_state(
        {},
        execution_status="stopping",
        run_id="run-2",
    )
    idle = chat_service._merge_session_state(
        stopping,
        execution_status="idle",
        run_id="run-2",
    )

    runtime = idle["runtime"]
    assert runtime["execution_status"] == "idle"
    assert runtime["current_run_id"] is None
    assert runtime["last_run_id"] == "run-2"
    assert runtime["stop_requested_at"] is None
    assert runtime["last_run_completed_at"] is not None


def test_preference_change_resets_agent_runtime_and_bumps_thread_version():
    current = {
        "preferences": {"quarter": "秋冬"},
        "runtime": {
            "agent_state": {"search_session": {"filters": [{"type": "meta", "key": "quarter", "value": "秋冬"}]}},
            "compaction": {"thread_version": 3, "active_summary_version": 1},
        },
    }

    next_config = chat_service._merge_session_state(
        current,
        preferences={"quarter": "春夏"},
    )

    assert chat_service._did_retrieval_preferences_change(current, next_config) is True

    reset = chat_service._reset_runtime_after_preference_change(next_config)
    assert reset["runtime"]["agent_state"] == {}
    assert reset["runtime"]["compaction"]["thread_version"] == 4
    assert reset["runtime"]["compaction"]["pending_bootstrap_thread_version"] is None


def test_normalize_session_preferences_merges_legacy_temporal_fields_into_compact_multi_selects():
    normalized = chat_service._merge_session_state(
        {},
        preferences={
            "quarter": "早秋",
            "year": 2026,
            "sources": ["wwd", "vogue"],
            "image_types": ["model", "flat lay"],
        },
    )["preferences"]

    assert normalized["season_groups"] == ["秋冬"]
    assert normalized["years"] == [2026]
    assert normalized["sources"] == ["vogue", "wwd"]
    assert normalized["image_types"] == ["model_photo", "flat_lay"]

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

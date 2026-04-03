from backend.app.services import style_feedback_service as service


def test_record_style_gap_feedback_normalizes_and_forwards(monkeypatch):
    captured = {}

    def _fake_upsert(**kwargs):
        captured.update(kwargs)
        return {"signal_id": "gap-1", "total_hits": 3, "unique_sessions": 2}

    monkeypatch.setattr(service, "upsert_style_gap_signal", _fake_upsert)

    payload = service.record_style_gap_feedback(
        query=" Quiet-Luxury ",
        session_id="session-1",
        thread_id="user-1:session-1",
        fallback_suggestion="try broader",
        extra_context={"message": "not found"},
    )

    assert payload["signal_id"] == "gap-1"
    assert captured["query_raw"] == "Quiet-Luxury"
    assert captured["query_normalized"] == "quiet luxury"
    assert captured["session_id"] == "session-1"
    assert captured["context"]["thread_id"] == "user-1:session-1"
    assert captured["context"]["message"] == "not found"


def test_record_style_gap_feedback_ignores_empty_queries():
    assert service.record_style_gap_feedback(query="   ") is None

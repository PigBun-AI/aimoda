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


def test_mark_style_gap_covered_normalizes_query(monkeypatch):
    captured = {}

    def _fake_mark(**kwargs):
        captured.update(kwargs)
        return {"signal_id": "gap-1", "status": "covered"}

    monkeypatch.setattr(service, "mark_style_gap_signal_covered", _fake_mark)

    payload = service.mark_style_gap_covered(
        query=" Quiet-Luxury ",
        linked_style_name="quiet luxury",
        resolution_note="ingested into style library",
    )

    assert payload["status"] == "covered"
    assert captured["query_normalized"] == "quiet luxury"
    assert captured["linked_style_name"] == "quiet luxury"


def test_list_style_gap_feedback_admin_clamps_and_forwards(monkeypatch):
    captured = {}

    def _fake_list(**kwargs):
        captured.update(kwargs)
        return {"items": [], "total": 0}

    monkeypatch.setattr(service, "list_style_gap_signals", _fake_list)

    payload = service.list_style_gap_feedback_admin(
        status="ignored",
        q="  rococo  ",
        min_hits=0,
        sort="last_seen",
        order="asc",
        limit=1000,
        offset=-7,
    )

    assert payload["total"] == 0
    assert captured["status"] == "ignored"
    assert captured["q"] == "rococo"
    assert captured["min_hits"] == 1
    assert captured["sort"] == "last_seen"
    assert captured["order"] == "asc"
    assert captured["limit"] == 100
    assert captured["offset"] == 0


def test_update_style_gap_feedback_admin_trims_values(monkeypatch):
    captured = {}

    def _fake_update(**kwargs):
        captured.update(kwargs)
        return {"id": "gap-1", "status": "ignored"}

    monkeypatch.setattr(service, "update_style_gap_signal", _fake_update)

    payload = service.update_style_gap_feedback_admin(
        signal_id="gap-1",
        status="ignored",
        linked_style_name="  ",
        resolution_note="  out of scope  ",
        resolved_by="  admin_user  ",
    )

    assert payload["status"] == "ignored"
    assert captured["signal_id"] == "gap-1"
    assert captured["status"] == "ignored"
    assert captured["linked_style_name"] is None
    assert captured["resolution_note"] == "out of scope"
    assert captured["resolved_by"] == "admin_user"

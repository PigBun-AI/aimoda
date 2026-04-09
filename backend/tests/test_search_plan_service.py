import pytest

from backend.app.services.search_plan_service import build_search_session_from_plan, materialize_search_plan_ref


def test_build_search_session_from_plan_builds_category_and_meta_filters(monkeypatch):
    monkeypatch.setattr(
        'backend.app.services.search_plan_service.encode_text',
        lambda text: [0.1, 0.2] if text == 'red dress' else None,
    )
    monkeypatch.setattr(
        'backend.app.services.search_plan_service.apply_aesthetic_boost',
        lambda vector: vector,
    )

    session = build_search_session_from_plan({
      'query': 'red dress',
      'categories': ['dress'],
      'brand': 'Akris',
      'quarter': '秋冬',
      'gender': 'female',
    })

    assert session['query'] == 'red dress'
    assert session['vector_type'] == 'fashion_clip'
    assert session['q_emb'] == [0.1, 0.2]
    assert session['filters'] == [
        {'type': 'category', 'key': 'category', 'value': 'dress'},
        {'type': 'meta', 'key': 'brand', 'value': 'Akris'},
        {'type': 'meta', 'key': 'gender', 'value': 'female'},
        {'type': 'meta', 'key': 'quarter', 'value': '秋冬'},
    ]


def test_materialize_search_plan_ref_uses_current_viewer_session_for_portable_refs(monkeypatch):
    captured: dict[str, object] = {}

    monkeypatch.setattr(
        'backend.app.services.search_plan_service.get_session',
        lambda session_id: (
            {'id': 'viewer-session', 'user_id': 2}
            if session_id == 'viewer-session'
            else {'id': 'source-session', 'user_id': 1}
            if session_id == 'source-session'
            else None
        ),
    )
    monkeypatch.setattr(
        'backend.app.services.search_plan_service.build_search_session_from_plan',
        lambda plan: {'query': 'black dress', 'filters': [{'type': 'meta', 'key': 'brand', 'value': 'COS'}], 'active': True},
    )
    monkeypatch.setattr('backend.app.services.search_plan_service.get_qdrant', lambda: object())
    monkeypatch.setattr('backend.app.services.search_plan_service.count_session', lambda client, search_session: 12)

    def fake_create_artifact(*, session_id, artifact_type, storage_type, metadata, expires_at):
        captured['session_id'] = session_id
        captured['metadata'] = metadata
        return {'id': 'artifact-1'}

    monkeypatch.setattr('backend.app.services.search_plan_service.create_artifact', fake_create_artifact)

    payload = materialize_search_plan_ref(
        user_id=2,
        session_id='source-session',
        current_session_id='viewer-session',
        plan={'label': 'COS', 'brand': 'COS', 'source': 'agent_recommendation'},
    )

    assert payload['search_request_id'] == 'artifact-1'
    assert captured['session_id'] == 'viewer-session'
    assert captured['metadata']['ref_source_session_id'] == 'source-session'
    assert captured['metadata']['artifact_session_id'] == 'viewer-session'
    assert captured['metadata']['ref_resolution_mode'] == 'portable_search_plan'


def test_materialize_search_plan_ref_rejects_missing_viewer_context(monkeypatch):
    monkeypatch.setattr('backend.app.services.search_plan_service.get_session', lambda session_id: None)

    with pytest.raises(ValueError, match='Search plan context session not found'):
        materialize_search_plan_ref(
            user_id=2,
            session_id='source-session',
            current_session_id='viewer-session',
            plan={'label': 'COS'},
        )

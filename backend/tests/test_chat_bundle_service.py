from types import SimpleNamespace

from backend.app.services import chat_bundle_service


def test_style_bundle_materializes_semantic_and_refined_groups(monkeypatch):
    created_artifacts: list[dict] = []

    final_search_session = {
        "query": "minimal tailored coat",
        "vector_type": "fashion_clip",
        "q_emb": [0.1, 0.2],
        "filters": [
            {"type": "meta", "key": "brand", "value": "the row"},
            {"type": "meta", "key": "quarter", "value": "秋冬"},
            {"type": "category", "key": "category", "value": "coat"},
            {"type": "garment_tag", "key": "coat:fabric", "value": "coat:wool"},
        ],
        "active": True,
    }

    def fake_get_artifact(artifact_id, session_id=None, artifact_type=None):
        if artifact_type == "collection_result":
            return {
                "id": artifact_id,
                "session_id": session_id,
                "artifact_type": "collection_result",
                "metadata": {
                    "search_session": final_search_session,
                    "total": 48,
                    "filters_applied": ["brand=the row", "quarter=秋冬", "category=coat", "coat:fabric=wool"],
                },
            }
        return None

    def fake_create_artifact(**kwargs):
        artifact = {
            "id": f"artifact-{len(created_artifacts) + 1}",
            **kwargs,
        }
        created_artifacts.append(artifact)
        return artifact

    monkeypatch.setattr(chat_bundle_service, "get_artifact", fake_get_artifact)
    monkeypatch.setattr(chat_bundle_service, "create_artifact", fake_create_artifact)
    monkeypatch.setattr(chat_bundle_service, "get_qdrant", lambda: object())
    monkeypatch.setattr(chat_bundle_service, "count_session", lambda client, session: 120 if len(session.get("filters", [])) <= 2 else 48)
    monkeypatch.setattr(chat_bundle_service, "get_session_page", lambda client, session, offset=0, limit=8: [SimpleNamespace(payload={"image_id": "img-1"}, score=0.9)])
    monkeypatch.setattr(chat_bundle_service, "format_result", lambda payload, score: {"image_id": payload.get("image_id"), "score": score})

    blocks = [
        {
            "type": "tool_result",
            "tool_use_id": "style-1",
            "content": '{"status":"ok","primary_style":{"style_name":"极简"},"retrieval_plan":{"retrieval_query_en":"minimal tailored coat","suggested_filters":{"quarter":["秋冬"],"fabric":["wool"]}}}',
        },
        {
            "type": "tool_result",
            "tool_use_id": "show-1",
            "content": '{"action":"show_collection","search_request_id":"final-artifact","query":"minimal tailored coat","filters_applied":["brand=the row","quarter=秋冬","category=coat","coat:fabric=wool"],"total":48}',
        },
    ]

    bundle = chat_bundle_service.maybe_materialize_style_bundle(
        session_id="session-1",
        message_id="message-1",
        blocks=blocks,
        request_query_text="想看极简大衣",
    )

    assert bundle is not None
    assert bundle["artifact"]["artifact_type"] == "bundle_result"
    assert len(bundle["groups"]) == 2
    assert bundle["groups"][0]["search_request_id"] == "artifact-1"
    assert bundle["groups"][1]["search_request_id"] == "final-artifact"

    semantic_artifact = created_artifacts[0]
    semantic_filters = semantic_artifact["metadata"]["search_session"]["filters"]
    assert semantic_filters == [
        {"type": "meta", "key": "brand", "value": "the row"},
        {"type": "category", "key": "category", "value": "coat"},
    ]
    assert created_artifacts[1]["metadata"]["bundle_kind"] == "style_exploration"

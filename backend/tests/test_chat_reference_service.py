from backend.app.services.chat_reference_service import (
    append_collection_result_references,
    build_bundle_group_metadata,
    build_bundle_result_metadata,
    build_message_ref_url,
    build_search_request_ref,
    extract_collection_result_payloads,
)


def test_append_collection_result_references_adds_summary_block():
    blocks = [
        {"type": "text", "text": "我先给你一组结果。"},
        {
            "type": "tool_result",
            "tool_use_id": "tool-1",
            "content": '{"action":"show_collection","search_request_id":"artifact-1","filters_applied":["brand=akris"],"query":"minimal tailoring"}',
        },
    ]

    enriched = append_collection_result_references(blocks)

    assert len(enriched) == 2
    assert enriched[0]["type"] == "text"
    annotations = enriched[0].get("annotations")
    assert isinstance(annotations, list)
    message_refs = annotations[0]
    assert message_refs["type"] == "message_refs"
    assert message_refs["count"] == 1
    assert message_refs["items"][0]["target"]["kind"] == "search_request"
    assert "akris" in message_refs["items"][0]["phrases"]


def test_build_message_ref_url_encodes_search_request_target():
    target = build_search_request_ref(search_request_id="artifact-2", label="结果组 1")
    url = build_message_ref_url(target)

    assert url.startswith("aimoda://ref/")


def test_build_bundle_result_metadata_from_multiple_collections():
    blocks = [
        {
            "type": "tool_result",
            "tool_use_id": "tool-1",
            "content": '{"action":"show_collection","search_request_id":"artifact-1","filters_applied":["brand=akris"],"query":"minimal tailoring","total":18}',
        },
        {
            "type": "tool_result",
            "tool_use_id": "tool-2",
            "content": '{"action":"show_collection","search_request_id":"artifact-2","filters_applied":["quarter=秋冬"],"query":"soft volume","total":12}',
        },
    ]

    payloads = extract_collection_result_payloads(blocks)
    metadata = build_bundle_result_metadata(payloads)

    assert metadata["group_count"] == 2
    assert [group["search_request_id"] for group in metadata["groups"]] == ["artifact-1", "artifact-2"]
    assert metadata["groups"][0]["label"].startswith("结果组 1")


def test_append_collection_result_references_supports_bundle_groups():
    blocks = [{"type": "text", "text": "这里是结果入口。"}]

    enriched = append_collection_result_references(
        blocks,
        bundle_artifact_id="bundle-1",
        bundle_groups=[
            build_bundle_group_metadata(
                group_id="semantic-group",
                label="语义参考",
                search_request_id="artifact-semantic",
            ),
            build_bundle_group_metadata(
                group_id="refined-group",
                label="精筛结果",
                search_request_id="artifact-refined",
            ),
        ],
    )

    annotations = enriched[0].get("annotations")
    assert isinstance(annotations, list)
    message_refs = annotations[0]
    labels = [item["label"] for item in message_refs["items"]]
    assert labels == ["语义参考", "精筛结果"]
    assert message_refs["items"][0]["target"]["kind"] == "bundle_group"
    assert "语义参考" in message_refs["items"][0]["phrases"]


def test_append_collection_result_references_falls_back_to_summary_block_without_text():
    blocks = [
        {
            "type": "tool_result",
            "tool_use_id": "tool-1",
            "content": '{"action":"show_collection","search_request_id":"artifact-1","filters_applied":["brand=akris"],"query":"minimal tailoring"}',
        },
    ]

    enriched = append_collection_result_references(blocks)

    assert len(enriched) == 2
    assert enriched[-1]["type"] == "text"
    assert "aimoda://ref/" in enriched[-1]["text"]
    annotations = enriched[-1].get("annotations")
    assert isinstance(annotations, list)
    assert annotations[0]["type"] == "message_refs"

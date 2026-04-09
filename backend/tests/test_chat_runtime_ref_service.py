from backend.app.services.chat_runtime_ref_service import attach_runtime_brand_refs


def test_attach_runtime_brand_refs_creates_brand_search_plan_from_grounded_style_brand():
    blocks = [
        {
            "type": "tool_result",
            "tool_use_id": "tool-style",
            "content": '{"status":"ok","style_features":{"reference_brands":["Akris","Jil Sander"]}}',
        },
        {
            "type": "tool_result",
            "tool_use_id": "tool-collection",
            "content": '{"action":"show_collection","search_request_id":"artifact-1","filters_applied":["category=dress","quarter=秋冬"],"query":"luxury red dress elegant silhouette","sample_images":[{"brand":"Valentino"}]}',
        },
        {
            "type": "text",
            "text": "如果你还想看更克制的方向，我会建议补充看看 Akris 的连衣裙。",
        },
    ]

    enriched, attached = attach_runtime_brand_refs(
        blocks,
        session_id="session-1",
        request_query_text="红色礼服裙",
    )

    assert attached is True
    annotations = enriched[-1]["annotations"]
    assert annotations[0]["type"] == "message_ref_spans"
    item = annotations[0]["items"][0]
    assert item["target"]["kind"] == "search_plan"
    assert item["target"]["brand"] == "Akris"
    assert item["target"]["quarter"] == "秋冬"
    assert item["target"]["query"] == "luxury red dress elegant silhouette"


def test_attach_runtime_brand_refs_matches_brand_case_insensitively_and_preserves_visible_quote():
    blocks = [
        {
            "type": "tool_result",
            "tool_use_id": "tool-collection",
            "content": '{"action":"show_collection","search_request_id":"artifact-1","filters_applied":["category=dress"],"query":"cold restrained black dress","sample_images":[{"brand":"giada"}]}',
        },
        {
            "type": "text",
            "text": "我会优先建议你继续看 **Giada** 的黑色连衣裙方向。",
        },
    ]

    enriched, attached = attach_runtime_brand_refs(
        blocks,
        session_id="session-1",
        request_query_text="黑色连衣裙",
    )

    assert attached is True
    item = enriched[-1]["annotations"][0]["items"][0]
    assert item["quote"] == "Giada"
    assert item["target"]["brand"] == "giada"


def test_attach_runtime_brand_refs_extracts_explicit_brand_suggestions_from_text_cues():
    blocks = [
        {
            "type": "tool_result",
            "tool_use_id": "tool-collection",
            "content": '{"action":"show_collection","search_request_id":"artifact-1","filters_applied":["gender=female"],"query":"Korean fashion Seoul street style casual relaxed everyday wear","sample_images":[{"brand":"system"}]}',
        },
        {
            "type": "text",
            "text": "如果你想继续聚焦，也可以进一步看特定品牌如 Acne Studios 或 COS。",
        },
    ]

    enriched, attached = attach_runtime_brand_refs(
        blocks,
        session_id="session-1",
        request_query_text="我想要韩系休闲穿搭",
    )

    assert attached is True
    items = enriched[-1]["annotations"][0]["items"]
    brands = {item["target"]["brand"] for item in items}
    assert "Acne Studios" in brands
    assert "COS" in brands

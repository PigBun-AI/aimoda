from backend.app.services.chat_structured_ref_service import (
    attach_structured_message_refs,
    strip_structured_ref_payload,
)


def test_attach_structured_message_refs_builds_inline_annotations():
    blocks = [
        {
            "type": "text",
            "text": (
                "我建议先看 Akris 的连衣裙，再补充看更克制的秋冬方向。"
                "[AIMODA_REFS]"
                '{"items":[{"quote":"Akris 的连衣裙","label":"Akris 连衣裙","query":"sculptural red dress luxury editorial","brand":"Akris","categories":["dress"],"quarter":"秋冬"}]}'
                "[/AIMODA_REFS]"
            ),
        }
    ]

    enriched, attached = attach_structured_message_refs(blocks, session_id="session-1")

    assert attached is True
    assert enriched[0]["text"] == "我建议先看 Akris 的连衣裙，再补充看更克制的秋冬方向。"
    annotations = enriched[0]["annotations"]
    assert annotations[0]["type"] == "message_ref_spans"
    item = annotations[0]["items"][0]
    assert item["quote"] == "Akris 的连衣裙"
    assert item["target"]["kind"] == "search_plan"
    assert item["target"]["brand"] == "Akris"
    assert item["target"]["quarter"] == "秋冬"


def test_strip_structured_ref_payload_removes_dangling_marker_suffix():
    content = "推荐先看 Akris。[AIMODA_REFS]{\"items\":[]}"

    assert strip_structured_ref_payload(content) == "推荐先看 Akris。"

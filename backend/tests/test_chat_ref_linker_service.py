from backend.app.services.chat_ref_linker_service import attach_message_ref_spans


def test_attach_message_ref_spans_links_grounded_phrase_into_text_block():
    blocks = [
        {
            "type": "text",
            "text": "这一组里 Akris 的轮廓更干净，建议先看 Akris。",
            "annotations": [
                {
                    "type": "message_refs",
                    "count": 1,
                    "items": [
                        {
                            "label": "Akris",
                            "target": {
                                "kind": "search_request",
                                "search_request_id": "artifact-1",
                                "label": "Akris",
                            },
                            "phrases": ["Akris", "AKRIS"],
                        }
                    ],
                }
            ],
        }
    ]

    enriched = attach_message_ref_spans(blocks)

    annotations = enriched[0]["annotations"]
    span_annotation = next(item for item in annotations if item["type"] == "message_ref_spans")
    assert span_annotation["items"][0]["quote"] == "Akris"
    assert span_annotation["items"][0]["occurrence"] == 1


def test_attach_message_ref_spans_skips_when_not_grounded():
    blocks = [
        {
            "type": "text",
            "text": "这一组更贴近你的方向。",
            "annotations": [
                {
                    "type": "message_refs",
                    "count": 1,
                    "items": [
                        {
                            "label": "Akris",
                            "target": {
                                "kind": "search_request",
                                "search_request_id": "artifact-1",
                                "label": "Akris",
                            },
                            "phrases": ["Akris"],
                        }
                    ],
                }
            ],
        }
    ]

    enriched = attach_message_ref_spans(blocks)

    assert all(item.get("type") != "message_ref_spans" for item in enriched[0]["annotations"])

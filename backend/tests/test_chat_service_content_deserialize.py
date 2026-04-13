from backend.app.services.chat_service import _deserialize_content


def test_deserialize_content_accepts_persisted_block_arrays():
    assert _deserialize_content([{"type": "text", "text": "hello"}]) == [{"type": "text", "text": "hello"}]


def test_deserialize_content_rejects_legacy_string_payloads():
    assert _deserialize_content("legacy plain text") == []

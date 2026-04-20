from backend.app.routers import chat as chat_router


def test_resolve_agent_stream_error_message_for_model_safety_rejection():
    error = Exception(
        "openai.BadRequestError: Error code: 400 - {'error': {'message': "
        "'<400> InternalError.Algo.DataInspectionFailed: Input text data may contain inappropriate content.', "
        "'code': 'data_inspection_failed'}}"
    )

    assert chat_router._resolve_agent_stream_error_message(error) == "当前问题触发了模型安全审核，请换一种表述后重试。"


def test_resolve_agent_stream_error_message_for_invalid_chat_history():
    error = Exception("INVALID_CHAT_HISTORY: tool calls do not have a corresponding ToolMessage")

    assert chat_router._resolve_agent_stream_error_message(error) == "invalid_chat_history"


def test_resolve_agent_stream_error_message_falls_back_to_generic_message():
    error = Exception("unexpected upstream failure")

    assert chat_router._resolve_agent_stream_error_message(error) == "Agent stream failed. Check server logs."

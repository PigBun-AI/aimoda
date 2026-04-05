from backend.app.agent import sse


def test_consume_thinking_buffer_splits_text_and_reasoning():
    actions, remainder, inside = sse._consume_thinking_buffer(
        "你好<think>内部分析</think>正式回复",
        inside_reasoning=False,
        final=True,
    )

    assert actions == [
        ("text", "你好"),
        ("reasoning_start", ""),
        ("reasoning", "内部分析"),
        ("reasoning_end", ""),
        ("text", "正式回复"),
    ]
    assert remainder == ""
    assert inside is False


def test_consume_thinking_buffer_preserves_partial_open_tag_until_next_chunk():
    actions, remainder, inside = sse._consume_thinking_buffer(
        "你好<thi",
        inside_reasoning=False,
        final=False,
    )

    assert actions == [("text", "你好")]
    assert remainder == "<thi"
    assert inside is False

    actions, remainder, inside = sse._consume_thinking_buffer(
        f"{remainder}nk>继续思考</think>",
        inside_reasoning=inside,
        final=True,
    )

    assert actions == [
        ("reasoning_start", ""),
        ("reasoning", "继续思考"),
        ("reasoning_end", ""),
    ]
    assert remainder == ""
    assert inside is False


def test_consume_thinking_buffer_closes_unfinished_reasoning_on_final_flush():
    actions, remainder, inside = sse._consume_thinking_buffer(
        "<think>未闭合的思考",
        inside_reasoning=False,
        final=True,
    )

    assert actions == [
        ("reasoning_start", ""),
        ("reasoning", "未闭合的思考"),
        ("reasoning_end", ""),
    ]
    assert remainder == ""
    assert inside is False

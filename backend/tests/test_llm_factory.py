from types import SimpleNamespace

from langchain_core.runnables import RunnableLambda

from backend.app import llm_factory


def test_build_llm_with_fallback_wraps_primary_when_enabled(monkeypatch):
    primary = RunnableLambda(lambda value: f"primary:{value}")
    fallback = RunnableLambda(lambda value: f"fallback:{value}")

    calls = []

    def _fake_builder(**kwargs):
        calls.append(kwargs)
        return primary if len(calls) == 1 else fallback

    monkeypatch.setattr(llm_factory, "_build_chat_model", _fake_builder)
    monkeypatch.setattr(
        llm_factory,
        "settings",
        SimpleNamespace(
            LLM_PROVIDER="anthropic",
            LLM_MODEL="primary-model",
            LLM_API_KEY="primary-key",
            LLM_BASE_URL="https://primary.example",
            LLM_THINKING_ENABLED=False,
            FALLBACK_LLM_ENABLED=True,
            FALLBACK_LLM_PROVIDER="openai",
            FALLBACK_LLM_MODEL="fallback-model",
            FALLBACK_LLM_API_KEY="fallback-key",
            FALLBACK_LLM_BASE_URL="https://fallback.example",
            FALLBACK_LLM_THINKING_ENABLED=False,
            OPENAI_API_KEY="",
            OPENAI_BASE_URL="",
        ),
    )

    runnable = llm_factory.build_llm_with_fallback(temperature=0.1, max_tokens=32768)

    assert len(calls) == 2
    assert calls[0]["thinking_enabled"] is False
    assert calls[1]["thinking_enabled"] is False
    assert runnable.invoke("x") == "primary:x"


def test_build_llm_with_fallback_skips_when_fallback_matches_primary(monkeypatch):
    primary = RunnableLambda(lambda value: f"primary:{value}")
    calls = []

    def _fake_builder(**kwargs):
        calls.append(kwargs)
        return primary

    monkeypatch.setattr(llm_factory, "_build_chat_model", _fake_builder)
    monkeypatch.setattr(
        llm_factory,
        "settings",
        SimpleNamespace(
            LLM_PROVIDER="openai",
            LLM_MODEL="same-model",
            LLM_API_KEY="primary-key",
            LLM_BASE_URL="https://same.example",
            LLM_THINKING_ENABLED=False,
            FALLBACK_LLM_ENABLED=True,
            FALLBACK_LLM_PROVIDER="openai",
            FALLBACK_LLM_MODEL="same-model",
            FALLBACK_LLM_API_KEY="fallback-key",
            FALLBACK_LLM_BASE_URL="https://same.example",
            FALLBACK_LLM_THINKING_ENABLED=False,
            OPENAI_API_KEY="",
            OPENAI_BASE_URL="",
        ),
    )

    runnable = llm_factory.build_llm_with_fallback(temperature=0.1, max_tokens=32768)

    assert len(calls) == 1
    assert calls[0]["thinking_enabled"] is False
    assert runnable.invoke("x") == "primary:x"


def test_build_chat_model_disables_thinking_for_anthropic(monkeypatch):
    captured = {}

    class FakeAnthropic:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setattr(llm_factory, "ChatAnthropic", FakeAnthropic)

    llm_factory._build_chat_model(
        provider="anthropic",
        model="qwen3.6-plus",
        api_key="test-key",
        base_url="https://example.com/anthropic",
        temperature=0,
        max_tokens=128,
        thinking_enabled=False,
    )

    assert captured["thinking"] == {"type": "disabled"}

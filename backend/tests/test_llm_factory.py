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
            FALLBACK_LLM_ENABLED=True,
            FALLBACK_LLM_PROVIDER="openai",
            FALLBACK_LLM_MODEL="fallback-model",
            FALLBACK_LLM_API_KEY="fallback-key",
            FALLBACK_LLM_BASE_URL="https://fallback.example",
            OPENAI_API_KEY="",
            OPENAI_BASE_URL="",
        ),
    )

    runnable = llm_factory.build_llm_with_fallback(temperature=0.1, max_tokens=32768)

    assert len(calls) == 2
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
            FALLBACK_LLM_ENABLED=True,
            FALLBACK_LLM_PROVIDER="openai",
            FALLBACK_LLM_MODEL="same-model",
            FALLBACK_LLM_API_KEY="fallback-key",
            FALLBACK_LLM_BASE_URL="https://same.example",
            OPENAI_API_KEY="",
            OPENAI_BASE_URL="",
        ),
    )

    runnable = llm_factory.build_llm_with_fallback(temperature=0.1, max_tokens=32768)

    assert len(calls) == 1
    assert runnable.invoke("x") == "primary:x"

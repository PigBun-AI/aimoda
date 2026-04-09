from __future__ import annotations

import logging
from typing import Any

from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI

from .config import settings

logger = logging.getLogger(__name__)


def _normalize_max_tokens(value: int | None) -> int | None:
    if value is None:
        return None
    return value if value > 0 else None


def _build_chat_model(
    *,
    provider: str,
    model: str,
    api_key: str,
    base_url: str,
    temperature: float,
    max_tokens: int | None,
    thinking_enabled: bool = False,
):
    normalized_provider = (provider or "openai").strip().lower()
    normalized_max_tokens = _normalize_max_tokens(max_tokens)

    if normalized_provider == "anthropic":
        kwargs: dict[str, Any] = {
            "model": model,
            "temperature": temperature,
            "anthropic_api_key": api_key,
            "anthropic_api_url": base_url,
        }
        if not thinking_enabled:
            kwargs["thinking"] = {"type": "disabled"}
        if normalized_max_tokens is not None:
            kwargs["max_tokens"] = normalized_max_tokens
        return ChatAnthropic(**kwargs)

    if normalized_provider == "openai":
        kwargs = {
            "model": model,
            "temperature": temperature,
            "api_key": api_key,
            "base_url": base_url,
        }
        if normalized_max_tokens is not None:
            kwargs["max_tokens"] = normalized_max_tokens
        return ChatOpenAI(**kwargs)

    raise ValueError(f"Unsupported LLM_PROVIDER: {provider}")


def build_llm_with_fallback(*, temperature: float, max_tokens: int | None):
    primary = _build_chat_model(
        provider=settings.LLM_PROVIDER,
        model=settings.LLM_MODEL,
        api_key=settings.LLM_API_KEY,
        base_url=settings.LLM_BASE_URL,
        temperature=temperature,
        max_tokens=max_tokens,
        thinking_enabled=settings.LLM_THINKING_ENABLED,
    )

    if not settings.FALLBACK_LLM_ENABLED:
        return primary

    fallback_provider = (settings.FALLBACK_LLM_PROVIDER or "openai").strip().lower()
    fallback_model = (settings.FALLBACK_LLM_MODEL or "qwen3.5-flash").strip()
    fallback_api_key = (settings.FALLBACK_LLM_API_KEY or settings.OPENAI_API_KEY or "").strip()
    fallback_base_url = (settings.FALLBACK_LLM_BASE_URL or settings.OPENAI_BASE_URL or "").strip()

    primary_signature = (
        (settings.LLM_PROVIDER or "").strip().lower(),
        (settings.LLM_MODEL or "").strip(),
        (settings.LLM_BASE_URL or "").strip(),
    )
    fallback_signature = (
        fallback_provider,
        fallback_model,
        fallback_base_url,
    )

    if not fallback_api_key or not fallback_base_url:
        logger.warning("LLM fallback is enabled but fallback credentials are incomplete; using primary model only")
        return primary

    if fallback_signature == primary_signature:
        return primary

    fallback = _build_chat_model(
        provider=fallback_provider,
        model=fallback_model,
        api_key=fallback_api_key,
        base_url=fallback_base_url,
        temperature=temperature,
        max_tokens=max_tokens,
        thinking_enabled=settings.FALLBACK_LLM_THINKING_ENABLED,
    )
    return primary.with_fallbacks([fallback])

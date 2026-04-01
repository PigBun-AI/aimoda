from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx

from ..config import settings

_SKILL_CACHE: str | None = None
_PROMPT_PATTERN = re.compile(
    r"<!--\s*PROMPT_START\s*-->(.*?)<!--\s*PROMPT_END\s*-->",
    re.DOTALL,
)


class FashionVisionError(RuntimeError):
    """Raised when fashion vision analysis cannot be completed."""


def _skills_root() -> Path:
    return Path(__file__).resolve().parents[2] / "skills"


def load_fashion_vision_prompt() -> str:
    global _SKILL_CACHE
    if _SKILL_CACHE is not None:
        return _SKILL_CACHE

    skill_path = _skills_root() / "fashion-vision" / "SKILL.md"
    raw = skill_path.read_text(encoding="utf-8")
    match = _PROMPT_PATTERN.search(raw)
    if not match:
        raise FashionVisionError(f"Fashion vision prompt markers not found in {skill_path}")
    _SKILL_CACHE = match.group(1).strip()
    return _SKILL_CACHE


def _image_content_block(image_block: dict[str, Any]) -> dict[str, Any] | None:
    source = image_block.get("source")
    if not isinstance(source, dict):
        return None

    source_type = str(source.get("type", "")).strip()
    if source_type == "url":
        url = str(source.get("url", "")).strip()
        if not url:
            return None
        return {
            "type": "image_url",
            "image_url": {"url": url},
        }

    if source_type == "base64":
        media_type = str(source.get("media_type", "image/jpeg")).strip() or "image/jpeg"
        data = str(source.get("data", "")).strip()
        if not data:
            return None
        return {
            "type": "image_url",
            "image_url": {"url": f"data:{media_type};base64,{data}"},
        }

    return None


def _user_message_parts(
    image_blocks: list[dict[str, Any]],
    user_request: str,
) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    request = user_request.strip()
    instruction = (
        "Analyze these fashion image(s) and return the required JSON only. "
        "Keep the retrieval query concise and optimized for fashion image search."
    )
    if request:
        instruction += f" User refinement: {request}"
    parts.append({"type": "text", "text": instruction})

    for image_block in image_blocks:
        image_content = _image_content_block(image_block)
        if image_content is not None:
            parts.append(image_content)

    return parts


def _extract_text_content(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise FashionVisionError("VLM response missing choices")

    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    if not isinstance(message, dict):
        raise FashionVisionError("VLM response missing message")

    content = message.get("content", "")
    if isinstance(content, str):
        return content.strip()

    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            item_type = item.get("type")
            if item_type == "text":
                text = item.get("text")
                if isinstance(text, str):
                    chunks.append(text)
        joined = "\n".join(chunk.strip() for chunk in chunks if chunk and chunk.strip())
        if joined:
            return joined

    raise FashionVisionError("VLM response did not contain text content")


def _extract_json_object(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
        cleaned = cleaned.strip()

    try:
        data = json.loads(cleaned)
        if isinstance(data, dict):
            return data
    except json.JSONDecodeError:
        pass

    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise FashionVisionError("VLM response did not contain a JSON object")

    candidate = cleaned[start : end + 1]
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise FashionVisionError(f"Failed to parse VLM JSON output: {exc}") from exc
    if not isinstance(data, dict):
        raise FashionVisionError("VLM JSON output was not an object")
    return data


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    normalized: list[str] = []
    for item in value:
        if item is None:
            continue
        text = str(item).strip()
        if text:
            normalized.append(text)
    return normalized


def _normalize_image_entry(index: int, value: Any) -> dict[str, Any]:
    entry = value if isinstance(value, dict) else {}
    confidence_raw = entry.get("confidence", 0)
    try:
        confidence = max(0.0, min(1.0, float(confidence_raw)))
    except (TypeError, ValueError):
        confidence = 0.0

    return {
        "image_index": int(entry.get("image_index", index + 1)),
        "summary_zh": str(entry.get("summary_zh", "")).strip(),
        "summary_en": str(entry.get("summary_en", "")).strip(),
        "visible_garments": _normalize_string_list(entry.get("visible_garments")),
        "dominant_colors": _normalize_string_list(entry.get("dominant_colors")),
        "fabrics": _normalize_string_list(entry.get("fabrics")),
        "silhouettes": _normalize_string_list(entry.get("silhouettes")),
        "style_keywords": _normalize_string_list(entry.get("style_keywords")),
        "confidence": confidence,
    }


def _normalize_output(data: dict[str, Any], image_count: int) -> dict[str, Any]:
    raw_images = data.get("images") if isinstance(data.get("images"), list) else []
    images = [_normalize_image_entry(index, item) for index, item in enumerate(raw_images[:image_count])]
    while len(images) < image_count:
        images.append(_normalize_image_entry(len(images), {}))

    merged = data.get("merged_understanding") if isinstance(data.get("merged_understanding"), dict) else {}
    hard_filters = merged.get("hard_filters") if isinstance(merged.get("hard_filters"), dict) else {}

    return {
        "images": images,
        "merged_understanding": {
            "summary_zh": str(merged.get("summary_zh", "")).strip(),
            "retrieval_query_en": str(merged.get("retrieval_query_en", "")).strip(),
            "style_keywords": _normalize_string_list(merged.get("style_keywords")),
            "hard_filters": {
                "category": _normalize_string_list(hard_filters.get("category")),
                "color": _normalize_string_list(hard_filters.get("color")),
                "fabric": _normalize_string_list(hard_filters.get("fabric")),
                "gender": str(hard_filters.get("gender", "")).strip(),
                "season": _normalize_string_list(hard_filters.get("season")),
            },
            "follow_up_questions_zh": _normalize_string_list(merged.get("follow_up_questions_zh")),
        },
    }


async def analyze_fashion_images(
    image_blocks: list[dict[str, Any]],
    *,
    user_request: str = "",
) -> dict[str, Any]:
    if not image_blocks:
        raise FashionVisionError("No images available for fashion vision analysis")
    if not settings.OPENAI_API_KEY:
        raise FashionVisionError("OPENAI_API_KEY is not configured")

    prompt = load_fashion_vision_prompt()
    user_parts = _user_message_parts(image_blocks, user_request)
    if len(user_parts) <= 1:
        raise FashionVisionError("No valid image sources available for fashion vision analysis")

    request_body = {
        "model": settings.VLM_MODEL,
        "temperature": settings.VLM_TEMPERATURE,
        "max_tokens": settings.VLM_MAX_TOKENS,
        "messages": [
            {"role": "system", "content": prompt},
            {"role": "user", "content": user_parts},
        ],
    }

    base_url = settings.OPENAI_BASE_URL.rstrip("/")
    endpoint = f"{base_url}/chat/completions"
    timeout = httpx.Timeout(settings.VLM_TIMEOUT_SECONDS)
    headers = {
        "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(endpoint, headers=headers, json=request_body)
        response.raise_for_status()
        payload = response.json()

    raw_text = _extract_text_content(payload)
    parsed = _extract_json_object(raw_text)
    normalized = _normalize_output(parsed, image_count=len(image_blocks))
    normalized["model"] = settings.VLM_MODEL
    return normalized

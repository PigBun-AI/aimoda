from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import httpx

from ..config import settings
from ..value_normalization import normalize_quarter_list

_SKILL_CACHE: str | None = None
_PROMPT_PATTERN = re.compile(
    r"<!--\s*PROMPT_START\s*-->(.*?)<!--\s*PROMPT_END\s*-->",
    re.DOTALL,
)
_STYLE_RETRIEVAL_QUERY_PROMPT = """
You generate retrieval-ready English fashion queries for FashionCLIP-style semantic search.

Goal:
- Translate the user's fashion intent into one precise English `retrieval_query_en`.
- The query can be moderately long and descriptive.
- Prioritize the user's wording and any attached image(s).
- If a low-confidence style-library reference is provided, use it only as a weak hint, never as ground truth.

Output rules:
- Return JSON only.
- Required fields:
  - `retrieval_query_en`: one English sentence or clause sequence optimized for fashion image retrieval
  - `style_rich_text`: a slightly richer English grounding text for semantic retrieval
  - `summary`: short summary of what cues were emphasized
- Do not output markdown.
- Do not mention uncertainty.
""".strip()


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


def _style_query_message_parts(
    *,
    image_blocks: list[dict[str, Any]],
    user_request: str,
    style_reference: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = []
    request = user_request.strip()
    if not request and not image_blocks:
        raise FashionVisionError("No text or images available for retrieval query generation")

    instruction_lines = [
        "Generate retrieval-ready English fashion search text.",
        "User request:",
        request or "(image-led request without extra text)",
    ]

    if style_reference:
        style_name = str(style_reference.get("style_name", "")).strip()
        score = style_reference.get("score")
        reference_text = str(style_reference.get("style_rich_text", "")).strip()
        reference_lines = ["Low-confidence style-library hint (weak reference only):"]
        if style_name:
            reference_lines.append(f"- candidate_style: {style_name}")
        if score not in (None, ""):
            reference_lines.append(f"- similarity_score: {score}")
        if reference_text:
            reference_lines.append(f"- reference_cues: {reference_text}")
        instruction_lines.extend(reference_lines)

    instruction_lines.extend([
        "Focus on garment category, silhouette, cut, palette, fabric, surface texture, styling details, and overall fashion mood.",
        "Prefer concrete visual descriptors over abstract trend labels.",
    ])
    parts.append({"type": "text", "text": "\n".join(instruction_lines)})

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
                # VLM cannot reliably infer official fashion-calendar quarter labels.
                # Only preserve explicit quarter when the upstream contract provides one.
                "quarter": normalize_quarter_list(hard_filters.get("quarter")),
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


async def generate_style_retrieval_query(
    *,
    user_request: str,
    image_blocks: list[dict[str, Any]] | None = None,
    style_reference: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not settings.OPENAI_API_KEY:
        raise FashionVisionError("OPENAI_API_KEY is not configured")

    user_parts = _style_query_message_parts(
        image_blocks=image_blocks or [],
        user_request=user_request,
        style_reference=style_reference,
    )
    request_body = {
        "model": settings.VLM_MODEL,
        "temperature": 0.1,
        "max_tokens": min(settings.VLM_MAX_TOKENS, 500),
        "messages": [
            {"role": "system", "content": _STYLE_RETRIEVAL_QUERY_PROMPT},
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
    retrieval_query_en = str(parsed.get("retrieval_query_en", "")).strip()
    if not retrieval_query_en:
        raise FashionVisionError("retrieval query generator returned empty retrieval_query_en")

    style_rich_text = str(parsed.get("style_rich_text", "")).strip() or retrieval_query_en
    return {
        "retrieval_query_en": retrieval_query_en,
        "style_rich_text": style_rich_text,
        "summary": str(parsed.get("summary", "")).strip(),
        "model": settings.VLM_MODEL,
    }

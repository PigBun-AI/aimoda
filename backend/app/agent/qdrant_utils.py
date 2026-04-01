"""
Qdrant client, utilities, and data formatting.

Extracted from tools.py to keep the tools module focused on
LangGraph tool definitions only.
"""

import base64
import httpx
import math
from qdrant_client import QdrantClient
from qdrant_client.models import (
    Filter, FieldCondition, MatchValue, MatchAny, Range,
)

# ═══════════════════════════════════════════════════════════════
#  Qdrant Client Singleton
# ═══════════════════════════════════════════════════════════════

_qdrant: QdrantClient | None = None


def get_qdrant() -> QdrantClient:
    """Get or create Qdrant client from settings."""
    global _qdrant
    if _qdrant is None:
        from ..config import settings
        _qdrant = QdrantClient(
            url=settings.QDRANT_URL,
            api_key=settings.QDRANT_API_KEY,
        )
    return _qdrant


def get_collection() -> str:
    """Get the Qdrant collection name from settings."""
    from ..config import settings
    return settings.QDRANT_COLLECTION


# ═══════════════════════════════════════════════════════════════
#  Embedding / Vector Search
# ═══════════════════════════════════════════════════════════════

_embedding_client: httpx.Client | None = None


def _get_embedding_client() -> httpx.Client:
    """Get or create a reusable HTTP client for embedding requests."""
    global _embedding_client
    if _embedding_client is None:
        _embedding_client = httpx.Client(timeout=30.0)
    return _embedding_client


def encode_text(text: str) -> list[float]:
    """Encode text to embedding vector via OpenAI-compatible endpoint.

    Uses Marqo/marqo-fashionSigLIP model (768-dim) at the configured
    embedding URL. Supports both text and image inputs.
    """
    from ..config import settings
    client = _get_embedding_client()
    resp = client.post(
        f"{settings.EMBEDDING_URL}/v1/embeddings",
        json={"model": settings.EMBEDDING_MODEL, "input": text},
    )
    resp.raise_for_status()
    data = resp.json()
    return data["data"][0]["embedding"]


def encode_image(
    *,
    image_base64: str | None = None,
    image_url: str | None = None,
    media_type: str = "image/jpeg",
) -> list[float]:
    """Encode an image into the shared FashionCLIP embedding space."""
    from ..config import settings

    if image_base64:
        payload_input = (
            image_base64
            if image_base64.startswith("data:")
            else f"data:{media_type};base64,{image_base64}"
        )
    elif image_url:
        image_resp = httpx.get(image_url, timeout=30.0)
        image_resp.raise_for_status()
        content_type = image_resp.headers.get("content-type", media_type)
        encoded = base64.b64encode(image_resp.content).decode("utf-8")
        payload_input = f"data:{content_type};base64,{encoded}"
    else:
        raise ValueError("encode_image requires image_base64 or image_url")

    client = _get_embedding_client()
    resp = client.post(
        f"{settings.EMBEDDING_URL}/v1/embeddings",
        json={
            "model": settings.EMBEDDING_MODEL,
            "input": payload_input,
            "input_type": "image",
        },
    )
    resp.raise_for_status()
    data = resp.json()
    return data["data"][0]["embedding"]


# ── Negative prompt aesthetic boost ──
_NEGATIVE_PROMPT = ("low quality, amateur photography, poor lighting, "
                    "unflattering angle, blurry, bad composition, portrait, fat")
_AESTHETIC_ALPHA = 1.0
_neg_embedding: list[float] | None = None


def _get_negative_embedding() -> list[float]:
    """Get (and cache) the negative prompt embedding for aesthetic boost."""
    global _neg_embedding
    if _neg_embedding is None:
        _neg_embedding = encode_text(_NEGATIVE_PROMPT)
    return _neg_embedding


def apply_aesthetic_boost(v_pos: list[float]) -> list[float]:
    """Apply negative prompt vector arithmetic: normalize(v_pos - α * v_neg).

    Pushes query embedding away from low-quality image characteristics,
    resulting in higher-aesthetic results ranking first.
    """
    v_neg = _get_negative_embedding()
    result = [p - _AESTHETIC_ALPHA * n for p, n in zip(v_pos, v_neg)]
    norm = math.sqrt(sum(x * x for x in result))
    if norm < 1e-9:
        return result
    return [x / norm for x in result]


# ═══════════════════════════════════════════════════════════════
#  Filter Building
# ═══════════════════════════════════════════════════════════════

def build_qdrant_filter(
    categories=None, brand=None, gender=None, top_categories=None,
    season=None, year_min=None, image_type=None,
    garment_tags=None,
) -> Filter | None:
    """Build Qdrant filter using ALL available database indexes."""
    conditions = []
    if brand:
        conditions.append(FieldCondition(key="brand", match=MatchValue(value=brand.lower())))
    if gender:
        conditions.append(FieldCondition(key="gender", match=MatchValue(value=gender.lower())))
    if image_type:
        conditions.append(FieldCondition(key="image_type", match=MatchValue(value=image_type)))
    if categories and not garment_tags:
        conditions.append(FieldCondition(
            key="categories", match=MatchAny(any=[c.lower() for c in categories])
        ))
    if top_categories:
        conditions.append(FieldCondition(
            key="top_categories", match=MatchAny(any=[tc.lower() for tc in top_categories])
        ))
    if season:
        conditions.append(FieldCondition(
            key="season", match=MatchAny(any=[s.lower() for s in season])
        ))
    if year_min:
        conditions.append(FieldCondition(key="year", range=Range(gte=year_min)))
    if garment_tags:
        conditions.append(FieldCondition(
            key="garment_tags", match=MatchAny(any=[t.lower() for t in garment_tags])
        ))
    return Filter(must=conditions) if conditions else None


def select_vector_type(query: str, style_keywords: list | None,
                       has_garment_attrs: bool) -> str:
    """Select best vector type based on query nature."""
    has_style = style_keywords and len(style_keywords) > 0
    if has_style and not has_garment_attrs:
        return "fashion_clip"
    return "tag"


# ═══════════════════════════════════════════════════════════════
#  Result Formatting
# ═══════════════════════════════════════════════════════════════

def format_result(payload: dict, score: float = 0) -> dict:
    """Format a Qdrant point payload into a standardized image result dict."""
    garments_summary = []
    for g in payload.get("garments", []):
        garment_bbox = g.get("bbox")
        # Validate garment bbox
        if garment_bbox and isinstance(garment_bbox, (list, tuple)) and len(garment_bbox) == 4:
            try:
                garment_bbox = [float(v) for v in garment_bbox]
            except (ValueError, TypeError):
                garment_bbox = None
        else:
            garment_bbox = None

        garments_summary.append({
            "name": g.get("name", ""),
            "category": g.get("category", ""),
            "top_category": g.get("top_category", ""),
            "pattern": g.get("pattern", ""),
            "fabric": g.get("fabric", ""),
            "silhouette": g.get("silhouette", ""),
            "sleeve_length": g.get("sleeve", ""),
            "garment_length": g.get("length", ""),
            "collar": g.get("collar", ""),
            "bbox": garment_bbox,
            "colors": [
                {"name": c.get("name", ""), "hex": c.get("hex", ""), "percentage": c.get("percentage", 0)}
                for c in g.get("colors", [])
            ],
        })

    # Full extracted_colors with hex, percentage, type, area
    extracted_colors = []
    for c in payload.get("extracted_colors", []):
        extracted_colors.append({
            "hex": c.get("hex", ""),
            "color_name": c.get("color_name", ""),
            "percentage": c.get("percentage", 0),
            "type": c.get("type", ""),
            "area": c.get("area", ""),
        })

    # Convert Qdrant person_bbox [x1,y1,x2,y2] (0-1) to aimoda-web bbox_range_percent format
    bbox = payload.get("person_bbox")
    object_area = None
    if bbox and isinstance(bbox, (list, tuple)) and len(bbox) == 4:
        try:
            x1, y1, x2, y2 = float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])
            if 0 <= x1 < x2 <= 1 and 0 <= y1 < y2 <= 1:
                object_area = {
                    "bbox_range_percent": {
                        "startX_percent": x1 * 100,
                        "startY_percent": y1 * 100,
                        "endX_percent": x2 * 100,
                        "endY_percent": y2 * 100,
                    },
                    "image_width": payload.get("image_width", 1000),
                    "image_height": payload.get("image_height", 1500),
                }
        except (ValueError, TypeError):
            pass

    return {
        "image_url": payload.get("image_url", ""),
        "image_id": payload.get("image_id", ""),
        "score": round(score, 4) if score else 0,
        "brand": payload.get("brand", ""),
        "style": payload.get("style", ""),
        "gender": payload.get("gender", ""),
        "quarter": payload.get("quarter", ""),
        "season": payload.get("season", ""),
        "year": payload.get("year", 0),
        "garments": garments_summary,
        "extracted_colors": extracted_colors,
        "colors": [c.get("color_name", "") for c in payload.get("extracted_colors", [])],
        "object_area": object_area,
    }


# ═══════════════════════════════════════════════════════════════
#  Guidance Builder (zero-result recommendations)
# ═══════════════════════════════════════════════════════════════

def build_guidance(client, base_filter_conditions: list, user_color: str | None,
                   user_categories: list | None) -> dict:
    """When 0 results, analyze what IS available and return structured guidance."""
    collection = get_collection()
    guidance = {"reason": "No matching items found in database."}

    if user_categories:
        cat_filter = Filter(must=[
            FieldCondition(key="categories", match=MatchAny(any=[c.lower() for c in user_categories]))
        ])
        pts = scroll_all(client, collection, scroll_filter=cat_filter)
        color_counter = {}
        for p in pts:
            for fam in p.payload.get("color_families", []):
                color_counter[fam] = color_counter.get(fam, 0) + 1
        available = sorted(color_counter.items(), key=lambda x: -x[1])[:10]
        guidance["available_colors_for_category"] = [
            {"color": c, "count": n} for c, n in available
        ]

    if user_color:
        color_filter = Filter(must=[
            FieldCondition(key="color_families", match=MatchAny(any=[user_color.lower()]))
        ])
        pts = scroll_all(client, collection, scroll_filter=color_filter)
        cat_counter = {}
        for p in pts:
            for cat in p.payload.get("categories", []):
                cat_counter[cat] = cat_counter.get(cat, 0) + 1
        available = sorted(cat_counter.items(), key=lambda x: -x[1])[:10]
        guidance["available_categories_for_color"] = [
            {"category": c, "count": n} for c, n in available
        ]

    return guidance


# ═══════════════════════════════════════════════════════════════
#  Scroll Utility
# ═══════════════════════════════════════════════════════════════

MAX_SCROLL = 200_000  # safety cap
SCROLL_PAGE = 500     # points per scroll page


def scroll_all(client, collection: str, scroll_filter=None,
               max_results: int = MAX_SCROLL) -> list:
    """Paginated scroll that fetches up to *max_results* points."""
    all_pts: list = []
    next_offset = None
    while len(all_pts) < max_results:
        batch_size = min(SCROLL_PAGE, max_results - len(all_pts))
        pts, next_offset = client.scroll(
            collection,
            scroll_filter=scroll_filter,
            limit=batch_size,
            offset=next_offset,
            with_payload=True,
            with_vectors=False,
        )
        all_pts.extend(pts)
        if next_offset is None or len(pts) < batch_size:
            break
    return all_pts


# ── Backward-compatible aliases (used by other modules) ──
# These allow existing imports like `from .tools import get_qdrant` to work
# during the transition period.
_format_result = format_result
_get_collection = get_collection
_encode_text = encode_text
_apply_aesthetic_boost = apply_aesthetic_boost
_build_qdrant_filter = build_qdrant_filter
_select_vector_type = select_vector_type
_build_guidance = build_guidance
_scroll_all = scroll_all

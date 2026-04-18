from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from ..agent.harness import infer_active_category
from ..agent.qdrant_utils import apply_aesthetic_boost, encode_text, get_qdrant
from ..agent.query_context import average_embeddings
from ..agent.session_state import available_values, count_session
from ..config import settings
from ..repositories.retrieval_session_repo import (
    create_retrieval_session,
    get_retrieval_session,
    replace_retrieval_session_filters,
    update_retrieval_session,
)
from .chat_service import create_artifact, get_session as get_chat_session


@dataclass(slots=True)
class ToolExecutionResult:
    payload: dict[str, Any]
    search_session: dict[str, Any] | None = None
    retrieval_session: dict[str, Any] | None = None


class RetrievalSessionEngineError(Exception):
    def __init__(self, message: str, *, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class RetrievalSessionEngine:
    def start_collection(self, ctx, payload: dict[str, Any]) -> ToolExecutionResult:
        cancel_check = ctx.cancel_check
        if cancel_check:
            cancel_check()

        query = str(payload.get("query", "") or "").strip()
        client = get_qdrant()
        query_context = dict(ctx.query_context or {})
        runtime_seed_filters = _runtime_plan_filter_entries(ctx.runtime_plan or {})

        image_vectors = query_context.get("image_embeddings", []) or []
        image_vector = average_embeddings(image_vectors) if image_vectors else None
        style_retrieval_query = str(query_context.get("style_retrieval_query", "") or "").strip()
        vision_retrieval_query = str(query_context.get("vision_retrieval_query", "") or "").strip()

        text_vector = encode_text(query, cancel_check=cancel_check) if query else None
        style_semantic_text = _compose_semantic_grounding_text(query_context)
        style_vector = encode_text(style_semantic_text, cancel_check=cancel_check) if style_semantic_text else None
        fused_vector = _fuse_query_vectors(
            text_vector=text_vector,
            style_vector=style_vector,
            image_vector=image_vector,
        )
        if fused_vector is not None:
            fused_vector = apply_aesthetic_boost(fused_vector)

        effective_query = query or style_retrieval_query or vision_retrieval_query
        retrieval_session_id = self._resolve_retrieval_session_id(ctx, payload)
        record = self._upsert_retrieval_session(
            ctx,
            retrieval_session_id=retrieval_session_id,
            source=ctx.source,
            query=effective_query,
            vector_type="fashion_clip",
            q_emb=fused_vector,
            active_filters=runtime_seed_filters,
            metadata={
                "style_retrieval_query": style_retrieval_query or None,
                "vision_retrieval_query": vision_retrieval_query or None,
            },
        )

        search_session = {
            "query": effective_query,
            "vector_type": "fashion_clip",
            "q_emb": fused_vector,
            "filters": runtime_seed_filters,
            "active": True,
            "retrieval_session_id": record["id"] if record else None,
        }
        count = count_session(client, search_session, cancel_check=cancel_check)
        seeded_filter_summary = [_format_filter_entry(item) for item in runtime_seed_filters]
        recommended_next_step = _post_collection_next_step(
            runtime_plan=ctx.runtime_plan or {},
            style_retrieval_query=style_retrieval_query,
        )

        return ToolExecutionResult(
            payload={
                "status": "collection_started",
                "retrieval_session_id": record["id"] if record else None,
                "total": count,
                "query": effective_query or "(all images)",
                "style_retrieval_query": style_retrieval_query or None,
                "vision_retrieval_query": vision_retrieval_query or None,
                "filters_applied": seeded_filter_summary,
                "seeded_filters": seeded_filter_summary,
                "recommended_next_step": recommended_next_step,
                "message": self._start_message(
                    total=count,
                    image_count=len(image_vectors),
                    has_semantic_grounding=bool(style_retrieval_query or vision_retrieval_query),
                    seeded_filter_summary=seeded_filter_summary,
                ),
            },
            search_session=search_session,
            retrieval_session=record,
        )

    def add_filter(self, ctx, payload: dict[str, Any]) -> ToolExecutionResult:
        cancel_check = ctx.cancel_check
        if cancel_check:
            cancel_check()

        session = self._load_search_session(ctx, payload)
        client = get_qdrant()

        dimension = _canonicalize_temporal_dimension(payload.get("dimension"))
        value = _normalize_optional_tool_string(payload.get("value"))
        category = _normalize_optional_tool_string(payload.get("category"))
        if category:
            category = category.lower()
        if not dimension:
            raise RetrievalSessionEngineError("Filter dimension must be a non-empty string.")
        if value is None:
            raise RetrievalSessionEngineError(f'Filter "{dimension}" requires a concrete non-empty value.')
        if dimension == "quarter":
            value = _normalize_quarter_value(value)
            if value is None:
                raise RetrievalSessionEngineError(
                    'Filter "quarter" requires a valid quarter value such as 早春 / 春夏 / 早秋 / 秋冬 / Resort / SS / FW.'
                )

        inferred_category = None
        garment_tag_dims = {"color", "fabric", "pattern", "silhouette"}
        garment_nested_dims = {"sleeve_length", "sleeve", "garment_length", "length", "collar"}
        meta_dims = {"brand", "gender", "quarter", "year_min", "image_type", "year", "source_site"}
        dim_to_field = {
            "sleeve_length": "sleeve",
            "sleeve": "sleeve",
            "garment_length": "length",
            "length": "length",
            "collar": "collar",
        }

        if not category and dimension in (garment_tag_dims | garment_nested_dims) and ctx.thread_id:
            inferred_category = infer_active_category(
                thread_id=ctx.thread_id,
                session_filters=session.get("filters", []),
            )
            if inferred_category:
                category = inferred_category

        if dimension == "category":
            entry = {"type": "category", "key": "category", "value": value.lower(), "dimension": "category"}
        elif dimension in garment_tag_dims and category:
            entry = {
                "type": "garment_tag",
                "key": f"{category}:{dimension}",
                "value": f"{category}:{value.lower()}",
                "category": category,
                "dimension": dimension,
            }
        elif dimension in garment_nested_dims and category:
            field = dim_to_field[dimension]
            dim_normalized = "sleeve_length" if dimension == "sleeve" else "garment_length" if dimension == "length" else dimension
            entry = {
                "type": "garment_attr",
                "key": f"{category}:{dim_normalized}",
                "field": field,
                "value": value,
                "category": category,
                "dimension": dim_normalized,
            }
        elif dimension in meta_dims:
            entry = {"type": "meta", "key": dimension, "value": value, "dimension": dimension}
        else:
            if dimension in (garment_tag_dims | garment_nested_dims):
                raise RetrievalSessionEngineError(
                    f"For '{dimension}' filter, specify which garment category. Example: add_filter('{dimension}', '{value}', category='dress')"
                )
            raise RetrievalSessionEngineError(f"Unknown dimension: {dimension}")

        test_session = dict(session)
        test_session["filters"] = list(session.get("filters", [])) + [entry]
        count = count_session(client, test_session, cancel_check=cancel_check, exact=True)
        retrieval_session_id = self._require_retrieval_session_id(session, payload)

        if count > 0:
            next_filters = list(session.get("filters", [])) + [entry]
            next_session = dict(session)
            next_session["filters"] = next_filters
            next_session["retrieval_session_id"] = retrieval_session_id
            record = update_retrieval_session(
                retrieval_session_id,
                active_filters=next_filters,
            )
            replace_retrieval_session_filters(retrieval_session_id, filters=next_filters)
            filter_summary = [_format_filter_entry(item) for item in next_filters]
            return ToolExecutionResult(
                payload={
                    "retrieval_session_id": retrieval_session_id,
                    "action": "filter_added",
                    "filter": f"{dimension}={value}" + (f" (on {category})" if category else ""),
                    "remaining": count,
                    "active_filters": filter_summary,
                    "message": f"Added {dimension}={value}. {count} images remaining.",
                    "resolved_category": inferred_category,
                },
                search_session=next_session,
                retrieval_session=record,
            )

        available = available_values(client, dimension, category, session.get("filters", []), cancel_check=cancel_check)
        return ToolExecutionResult(
            payload={
                "retrieval_session_id": retrieval_session_id,
                "action": "filter_rejected",
                "filter": f"{dimension}={value}" + (f" (on {category})" if category else ""),
                "remaining": 0,
                "message": f"Adding {dimension}={value} would result in 0 images. Filter NOT added.",
                "available_values": available,
                "suggestion": "Try one of the available values instead, or skip this dimension.",
            },
            search_session=session,
            retrieval_session=get_retrieval_session(retrieval_session_id),
        )

    def remove_filter(self, ctx, payload: dict[str, Any]) -> ToolExecutionResult:
        cancel_check = ctx.cancel_check
        if cancel_check:
            cancel_check()

        session = self._load_search_session(ctx, payload)
        client = get_qdrant()
        dimension = _canonicalize_temporal_dimension(payload.get("dimension"))
        category = _normalize_optional_tool_string(payload.get("category"))
        if category:
            category = category.lower()

        removed: list[dict[str, Any]] = []
        new_filters: list[dict[str, Any]] = []
        for filter_entry in session.get("filters", []):
            match = False
            if dimension == "category" and filter_entry.get("type") == "category":
                match = True
            elif filter_entry.get("type") in {"garment_tag", "garment_attr"} and category:
                if str(filter_entry.get("key", "")).startswith(f"{category}:{dimension}"):
                    match = True
            elif filter_entry.get("type") == "meta" and filter_entry.get("key") == dimension:
                match = True
            if match:
                removed.append(filter_entry)
            else:
                new_filters.append(filter_entry)

        next_session = dict(session)
        next_session["filters"] = new_filters
        retrieval_session_id = self._require_retrieval_session_id(session, payload)
        record = update_retrieval_session(retrieval_session_id, active_filters=new_filters)
        replace_retrieval_session_filters(retrieval_session_id, filters=new_filters)
        count = count_session(client, next_session, cancel_check=cancel_check, exact=False)

        return ToolExecutionResult(
            payload={
                "retrieval_session_id": retrieval_session_id,
                "action": "filter_removed",
                "removed": [f"{item.get('key', '')}={item.get('value', '')}" for item in removed],
                "remaining": count,
                "active_filters": [_format_filter_entry(item) for item in new_filters],
                "message": f"Removed {len(removed)} filter(s). {count} images remaining.",
            },
            search_session=next_session,
            retrieval_session=record,
        )

    def show_collection(self, ctx, payload: dict[str, Any]) -> ToolExecutionResult:
        cancel_check = ctx.cancel_check
        if cancel_check:
            cancel_check()

        session = self._load_search_session(ctx, payload)
        client = get_qdrant()
        count = count_session(client, session, cancel_check=cancel_check)
        filter_summary = [_format_filter_entry(item) for item in session.get("filters", [])]
        retrieval_session_id = self._require_retrieval_session_id(session, payload)

        search_request_id = None
        if ctx.chat_session_id:
            artifact = create_artifact(
                session_id=ctx.chat_session_id,
                artifact_type="collection_result",
                storage_type="database",
                metadata={
                    "search_session": _serialize_search_session(session),
                    "total": count,
                    "filters_applied": filter_summary,
                    "retrieval_session_id": retrieval_session_id,
                },
                expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            )
            search_request_id = artifact["id"]

        record = update_retrieval_session(
            retrieval_session_id,
            active_filters=session.get("filters", []),
            search_artifact_ref=search_request_id if search_request_id is not None else None,
        )
        return ToolExecutionResult(
            payload={
                "action": "show_collection",
                "retrieval_session_id": retrieval_session_id,
                "search_request_id": search_request_id,
                "total": count,
                "query": str(session.get("query", "") or ""),
                "filters_applied": filter_summary,
                "recommended_next_step": _current_runtime_next_step(ctx.runtime_plan or {}) or "done",
                "message": f"Showing {count} matching images in paginated results. Filters applied: {len(filter_summary)}.",
            },
            search_session=session,
            retrieval_session=record,
        )

    def _resolve_retrieval_session_id(self, ctx, payload: dict[str, Any]) -> str | None:
        explicit = _normalize_optional_tool_string(payload.get("retrieval_session_id"))
        if explicit:
            return explicit
        current = ctx.current_search_session or {}
        current_id = _normalize_optional_tool_string(current.get("retrieval_session_id"))
        return current_id

    def _require_retrieval_session_id(self, session: dict[str, Any], payload: dict[str, Any]) -> str:
        retrieval_session_id = _normalize_optional_tool_string(payload.get("retrieval_session_id")) or _normalize_optional_tool_string(session.get("retrieval_session_id"))
        if not retrieval_session_id:
            raise RetrievalSessionEngineError("No active retrieval session.")
        return retrieval_session_id

    def _chat_session_owner_id(self, chat_session_id: str | None) -> int | None:
        if not chat_session_id:
            return None
        try:
            chat_session = get_chat_session(chat_session_id)
        except Exception:
            return None
        if not chat_session:
            return None
        user_id = chat_session.get("user_id")
        return int(user_id) if user_id is not None else None

    def _maybe_actor_user_id(self, ctx) -> int | None:
        if ctx.actor.user_id is not None:
            return int(ctx.actor.user_id)
        chat_owner_id = self._chat_session_owner_id(ctx.chat_session_id)
        if chat_owner_id is not None:
            return chat_owner_id
        return None

    def _actor_ref(self, ctx) -> dict[str, Any]:
        if ctx.actor.agent_id:
            return {
                "actor_type": "agent",
                "actor_id": str(ctx.actor.agent_id).strip(),
                "user_id": None,
            }

        actor_user_id = self._maybe_actor_user_id(ctx)
        if actor_user_id is None:
            raise RetrievalSessionEngineError("Actor identity is required for retrieval session operations.", status_code=401)
        return {
            "actor_type": "user",
            "actor_id": str(actor_user_id),
            "user_id": actor_user_id,
        }

    def _load_retrieval_record(self, ctx, retrieval_session_id: str) -> dict[str, Any]:
        record = get_retrieval_session(retrieval_session_id)
        if not record:
            raise RetrievalSessionEngineError("Retrieval session not found.", status_code=404)
        actor_ref = self._actor_ref(ctx)
        record_actor_type = str(record.get("actor_type") or ("user" if record.get("user_id") is not None else "agent"))
        record_actor_id = str(record.get("actor_id") or (record.get("user_id") if record.get("user_id") is not None else "")).strip()
        if record_actor_type != actor_ref["actor_type"] or record_actor_id != actor_ref["actor_id"]:
            raise RetrievalSessionEngineError("You do not have access to this retrieval session.", status_code=403)
        return record

    def _upsert_retrieval_session(self, ctx, *, retrieval_session_id: str | None, source: str, query: str, vector_type: str, q_emb: list[float] | None, active_filters: list[dict[str, Any]], metadata: dict[str, Any] | None) -> dict[str, Any] | None:
        actor_ref = self._actor_ref(ctx)
        if retrieval_session_id:
            existing = self._load_retrieval_record(ctx, retrieval_session_id)
            record = update_retrieval_session(
                existing["id"],
                query=query,
                vector_type=vector_type,
                q_emb=q_emb or [],
                active_filters=active_filters,
                metadata=metadata or {},
                status="active",
            )
            replace_retrieval_session_filters(existing["id"], filters=active_filters)
            return record or self._load_retrieval_record(ctx, existing["id"])

        record = create_retrieval_session(
            actor_type=actor_ref["actor_type"],
            actor_id=actor_ref["actor_id"],
            user_id=actor_ref["user_id"],
            chat_session_id=ctx.chat_session_id,
            source=source,
            query=query,
            vector_type=vector_type,
            q_emb=q_emb or [],
            active_filters=active_filters,
            metadata=metadata or {},
        )
        replace_retrieval_session_filters(record["id"], filters=active_filters)
        return record

    def _load_search_session(self, ctx, payload: dict[str, Any]) -> dict[str, Any]:
        retrieval_session_id = self._resolve_retrieval_session_id(ctx, payload)
        if not retrieval_session_id:
            raise RetrievalSessionEngineError("No active collection. Call start_collection first.")

        current = dict(ctx.current_search_session or {})
        if current.get("active") and current.get("retrieval_session_id") == retrieval_session_id:
            return current

        record = self._load_retrieval_record(ctx, retrieval_session_id)
        return {
            "query": str(record.get("query", "") or ""),
            "vector_type": str(record.get("vector_type", "fashion_clip") or "fashion_clip"),
            "q_emb": list(record.get("q_emb") or []) or None,
            "filters": list(record.get("active_filters") or []),
            "active": True,
            "retrieval_session_id": record["id"],
        }

    def _start_message(self, *, total: int, image_count: int, has_semantic_grounding: bool, seeded_filter_summary: list[str]) -> str:
        if image_count and has_semantic_grounding:
            base = f"Collection started with {total} images using {image_count} uploaded image(s) and semantic grounding. Inspect or show this pool first; only add filters if the user explicitly wants tighter precision or the pool is still too broad."
        elif image_count:
            base = f"Collection started with {total} images using {image_count} uploaded image(s). Use add_filter to narrow down."
        elif has_semantic_grounding:
            base = f"Collection started with {total} images using semantic grounding. Inspect or show this pool first; only add filters if the user explicitly wants tighter precision or the pool is still too broad."
        else:
            base = f"Collection started with {total} images. Use add_filter to narrow down."
        if seeded_filter_summary:
            base += f" Default hard filters applied: {', '.join(seeded_filter_summary)}."
        return base


def _normalize_optional_tool_string(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    if isinstance(value, (int, float, bool)):
        normalized = str(value).strip()
        return normalized or None
    return None


def _normalize_quarter_value(value: object) -> str | None:
    from ..value_normalization import normalize_quarter_value as _normalize

    return _normalize(value)


def _canonicalize_temporal_dimension(value: str | None) -> str:
    normalized = (_normalize_optional_tool_string(value) or "").lower()
    return normalized


def _runtime_plan_filter_entries(runtime_plan: dict[str, Any]) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for item in runtime_plan.get("hard_filters", []):
        if not isinstance(item, dict):
            continue
        dimension = str(item.get("dimension", "") or "").strip().lower()
        value = item.get("value")
        if not dimension or value in (None, ""):
            continue
        if dimension == "category":
            entry = {"type": "category", "key": "category", "value": str(value).strip().lower(), "dimension": "category"}
        elif dimension in {"brand", "gender", "quarter", "year", "year_min", "image_type", "source_site"}:
            entry = {"type": "meta", "key": dimension, "value": value, "dimension": dimension}
        else:
            continue
        if entry not in entries:
            entries.append(entry)
    return entries


def _current_runtime_next_step(runtime_plan: dict[str, Any]) -> str:
    return str(runtime_plan.get("next_step_hint", "") or "").strip()


def _post_collection_next_step(*, runtime_plan: dict[str, Any], style_retrieval_query: str = "") -> str:
    next_step = _current_runtime_next_step(runtime_plan)
    if next_step == "start_collection_then_add_brand_filter":
        return "add_brand_filter"
    if next_step == "start_collection":
        return "show_collection" if style_retrieval_query else "add_filter"
    if next_step:
        return next_step
    return "show_collection" if style_retrieval_query else "add_filter"


def _compose_semantic_grounding_text(query_context: dict[str, Any]) -> str:
    style_rich_text = str(query_context.get("style_rich_text", "") or "").strip()
    style_retrieval_query = str(query_context.get("style_retrieval_query", "") or "").strip()
    vision_retrieval_query = str(query_context.get("vision_retrieval_query", "") or "").strip()
    parts: list[str] = []
    if style_rich_text:
        parts.append(style_rich_text)
    elif style_retrieval_query:
        parts.append(style_retrieval_query)
    if vision_retrieval_query:
        parts.append(f"vision_reference: {vision_retrieval_query}")
    return "\n".join(part for part in parts if part).strip()


def _normalize_vector(vector: list[float]) -> list[float]:
    norm = sum(value * value for value in vector) ** 0.5
    if norm < 1e-9:
        return vector
    return [value / norm for value in vector]


def _fuse_query_vectors(*, text_vector: list[float] | None, style_vector: list[float] | None = None, image_vector: list[float] | None) -> list[float] | None:
    vectors = {"text": text_vector, "style": style_vector, "image": image_vector}
    available = {name: vector for name, vector in vectors.items() if vector is not None}
    if not available:
        return None
    if len(available) == 1:
        return _normalize_vector(next(iter(available.values())) or [])
    if image_vector is not None and style_vector is not None and text_vector is not None:
        weights = {"image": 0.5, "style": 0.3, "text": 0.2}
    elif style_vector is not None and text_vector is not None:
        weights = {"style": 0.65, "text": 0.35}
    elif image_vector is not None and style_vector is not None:
        weights = {"image": 0.65, "style": 0.35}
    elif image_vector is not None and text_vector is not None:
        weights = {"image": 0.7, "text": 0.3}
    else:
        weights = {name: 1.0 / len(available) for name in available}
    reference = next(iter(available.values()))
    fused = [0.0] * len(reference)
    for name, vector in available.items():
        assert vector is not None
        weight = weights.get(name, 0.0)
        for index, value in enumerate(vector):
            fused[index] += weight * value
    return _normalize_vector(fused)


def _format_filter_entry(filter_item: dict[str, Any]) -> str:
    from ..value_normalization import normalize_image_type_list, normalize_quarter_list, normalize_quarter_value, normalize_site_list, normalize_year_list

    if filter_item.get("type") == "category":
        return f"category={filter_item['value']}"
    if filter_item.get("type") == "garment_tag":
        return f"{filter_item['key']}={str(filter_item['value']).split(':')[1]}"

    key = str(filter_item.get("key", "") or "").strip()
    value = filter_item.get("value", "")
    if isinstance(value, list):
        if key == "quarter":
            serialized = normalize_quarter_list(value)
        elif key == "year":
            serialized = normalize_year_list(value)
        elif key == "image_type":
            serialized = normalize_image_type_list(value)
        elif key == "source_site":
            serialized = normalize_site_list(value)
        else:
            serialized = [str(item).strip() for item in value if str(item).strip()]
        value = ",".join(str(item) for item in serialized)
    elif key == "quarter":
        normalized = normalize_quarter_value(value)
        if normalized:
            value = normalized
    display_key = "site" if key == "source_site" else key
    return f"{display_key}={value}"


def _serialize_search_session(session: dict[str, Any]) -> dict[str, Any]:
    q_emb_raw = session.get("q_emb")
    q_emb_list = q_emb_raw.tolist() if hasattr(q_emb_raw, "tolist") else list(q_emb_raw) if q_emb_raw is not None else None
    return {
        "query": session.get("query", ""),
        "vector_type": session.get("vector_type", "tag"),
        "q_emb": q_emb_list,
        "filters": session.get("filters", []),
        "active": bool(session.get("active", False)),
        "retrieval_session_id": session.get("retrieval_session_id"),
    }

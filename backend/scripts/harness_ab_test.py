import json
from unittest.mock import patch

from backend.app.agent.tools import add_filter
from backend.app.agent.session_state import set_session
from backend.app.agent.harness import build_turn_context, set_turn_context, clear_turn_context
from backend.app.config import settings


CONFIG = {"configurable": {"thread_id": "test-harness-ab"}}
THREAD_ID = CONFIG["configurable"]["thread_id"]


def reset_session_with_category(category: str | None):
    session = {
        "query": "",
        "vector_type": "tag",
        "q_emb": None,
        "filters": [{"type": "category", "value": category}] if category else [],
        "active": True,
    }
    set_session(CONFIG, session)


def run_variant(use_harness: bool):
    clear_turn_context(THREAD_ID)
    reset_session_with_category(None)

    if use_harness:
        context = build_turn_context(
            query_text="我想要找蓝色的娃娃领连衣裙",
            has_images=False,
        )
        set_turn_context(THREAD_ID, context)

    with patch.object(settings, "AGENT_RUNTIME_HARNESS_ENABLED", use_harness), patch.object(
        settings, "AGENT_RUNTIME_HARNESS_MAX_SAME_ERROR_RETRIES", 1
    ), patch("backend.app.agent.tools.count_session", return_value=130), patch(
        "backend.app.agent.tools.available_values", return_value=[{"value": "dress", "count": 1}]
    ):
        result = json.loads(
            add_filter.func(
                "collar",
                "peter pan collar",
                config=CONFIG,
            )
        )
    return result


def main():
    no_harness = run_variant(use_harness=False)
    print("Variant A (no harness):", json.dumps(no_harness, ensure_ascii=False, indent=2))

    harnessed = run_variant(use_harness=True)
    print("Variant B (harness):", json.dumps(harnessed, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

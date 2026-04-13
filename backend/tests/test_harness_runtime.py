import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.app.agent.tools import add_filter, analyze_trends, start_collection
from backend.app.agent.session_state import set_session, get_session
from backend.app.agent.harness import (
    _session_semantics,
    _runtime_plans,
    build_runtime_plan,
    build_turn_context,
    set_runtime_plan,
    set_turn_context,
    clear_turn_context,
)
from backend.app.value_normalization import normalize_quarter_value
from backend.app.routers.chat import _restore_agent_session_from_runtime_state
from backend.app.config import settings


class HarnessRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.config = {"configurable": {"thread_id": "test-harness-runtime"}}
        self.thread_id = self.config["configurable"]["thread_id"]

    def tearDown(self):
        clear_turn_context(self.thread_id)
        _session_semantics.clear()
        _runtime_plans.clear()

    @patch("backend.app.agent.tools.count_session", return_value=120)
    @patch("backend.app.agent.tools.available_values", return_value=[])
    def test_infers_category_for_single_category_session(
        self, mock_available, mock_count
    ):
        session = {
            "query": "",
            "vector_type": "tag",
            "q_emb": None,
            "filters": [],
            "active": True,
        }
        set_session(self.config, session)

        turn_context = build_turn_context(
            query_text="我想要找娃娃领的连衣裙", has_images=False
        )
        set_turn_context(self.thread_id, turn_context)

        with patch.object(settings, "AGENT_RUNTIME_HARNESS_ENABLED", True):
            result = json.loads(
                add_filter.func(
                    "collar",
                    "peter pan collar",
                    config=self.config,
                )
            )

        self.assertEqual(result.get("action"), "filter_added")
        self.assertEqual(result.get("resolved_category"), "dress")

    def test_structured_error_blocks_repeat_calls(self):
        session = {
            "query": "",
            "vector_type": "tag",
            "q_emb": None,
            "filters": [],
            "active": True,
        }
        set_session(self.config, session)

        with patch.object(settings, "AGENT_RUNTIME_HARNESS_ENABLED", True), patch.object(
            settings, "AGENT_RUNTIME_HARNESS_MAX_SAME_ERROR_RETRIES", 1
        ):
            first = json.loads(
                add_filter.func(
                    "collar",
                    "peter pan collar",
                    config=self.config,
                )
            )
            second = json.loads(
                add_filter.func(
                    "collar",
                    "peter pan collar",
                    config=self.config,
                )
            )

        self.assertEqual(first.get("error_type"), "invalid_filter_request")
        self.assertFalse(first.get("retry_same_call", True))
        self.assertEqual(second.get("error_type"), "retry_blocked")
        self.assertTrue(second.get("blocked_by_harness"))

    @patch("backend.app.agent.tools.count_session", return_value=48)
    def test_uses_existing_session_filter_category_for_followup_turn(self, mock_count):
        session = {
            "query": "",
            "vector_type": "tag",
            "q_emb": None,
            "filters": [{"type": "garment_tag", "key": "dress:color", "value": "dress:blue"}],
            "active": True,
        }
        set_session(self.config, session)

        turn_context = build_turn_context(
            query_text="再加一个收腰",
            has_images=False,
            session_filters=session["filters"],
            session_active=True,
        )
        set_turn_context(self.thread_id, turn_context)

        with patch.object(settings, "AGENT_RUNTIME_HARNESS_ENABLED", True):
            result = json.loads(
                add_filter.func(
                    "silhouette",
                    "fitted",
                    config=self.config,
                )
            )

        self.assertEqual(result.get("action"), "filter_added")
        self.assertEqual(result.get("resolved_category"), "dress")

    def test_rejects_empty_filter_value_before_tool_validation(self):
        session = {
            "query": "",
            "vector_type": "tag",
            "q_emb": None,
            "filters": [],
            "active": True,
        }
        set_session(self.config, session)

        result = json.loads(
            add_filter.func(
                "color",
                "",
                config=self.config,
            )
        )

        self.assertEqual(result.get("error_type"), "invalid_arguments")
        self.assertFalse(result.get("retry_same_call", True))

    def test_tool_schema_allows_null_value_and_returns_structured_error(self):
        session = {
            "query": "",
            "vector_type": "tag",
            "q_emb": None,
            "filters": [],
            "active": True,
        }
        set_session(self.config, session)

        result = json.loads(add_filter.invoke({"dimension": "color", "value": None}, config=self.config))

        self.assertEqual(result.get("error_type"), "invalid_arguments")
        self.assertFalse(result.get("retry_same_call", True))

    def test_add_filter_uses_exact_count_validation(self):
        session = {
            "query": "",
            "vector_type": "tag",
            "q_emb": None,
            "filters": [],
            "active": True,
        }
        set_session(self.config, session)

        with patch("backend.app.agent.tools.get_qdrant", return_value=object()), patch(
            "backend.app.agent.tools.count_session",
            return_value=12,
        ) as mock_count:
            result = json.loads(
                add_filter.func(
                    "brand",
                    "Akris",
                    config=self.config,
                )
            )

        self.assertEqual(result.get("action"), "filter_added")
        self.assertEqual(mock_count.call_count, 1)
        self.assertTrue(mock_count.call_args.kwargs["exact"])

    @patch("backend.app.agent.tools.count_session", return_value=24)
    def test_brand_only_request_autobinds_missing_add_filter_dimension_to_brand(self, mock_count):
        session = {
            "query": "",
            "vector_type": "tag",
            "q_emb": None,
            "filters": [],
            "active": True,
        }
        set_session(self.config, session)
        set_turn_context(
            self.thread_id,
            build_turn_context(query_text="我只想看 Akris 这个品牌的图片", has_images=False),
        )

        with patch("backend.app.agent.tools.get_qdrant", return_value=object()):
            result = json.loads(
                add_filter.func(
                    None,
                    "Akris",
                    config=self.config,
                )
            )

        self.assertEqual(result.get("action"), "filter_added")
        self.assertIn("brand=Akris", result.get("message", ""))

    def test_brand_only_request_autobinds_missing_trend_dimension_to_brand(self):
        set_turn_context(
            self.thread_id,
            build_turn_context(query_text="我只想看 Akris 这个品牌的图片", has_images=False),
        )

        with patch("backend.app.agent.tools.get_collection", return_value="fashion_items"), patch(
            "backend.app.agent.tools.get_qdrant", return_value=object()
        ), patch("backend.app.agent.tools.build_qdrant_filter", return_value=None), patch(
            "backend.app.agent.tools.iter_scroll", return_value=iter([])
        ):
            result = json.loads(
                analyze_trends.invoke(
                    {"dimension": None, "brand": "Akris"},
                    config=self.config,
                )
            )

        self.assertEqual(result.get("dimension"), "brand")
        self.assertEqual(result.get("total_items_analyzed"), 0)

    def test_analyze_trends_uses_qdrant_facet_for_brand_dimension(self):
        class _FakeClient:
            def facet(self, **kwargs):
                return SimpleNamespace(
                    hits=[
                        SimpleNamespace(value="dior", count=12),
                        SimpleNamespace(value="gucci", count=8),
                    ]
                )

            def count(self, **kwargs):
                return SimpleNamespace(count=20)

        with patch("backend.app.agent.tools.get_collection", return_value="fashion_items"), patch(
            "backend.app.agent.tools.get_qdrant", return_value=_FakeClient()
        ), patch("backend.app.agent.tools.build_qdrant_filter", return_value=None), patch(
            "backend.app.agent.tools.iter_scroll"
        ) as mock_iter_scroll:
            result = json.loads(
                analyze_trends.invoke(
                    {"dimension": "brand", "top_n": 5},
                    config=self.config,
                )
            )

        mock_iter_scroll.assert_not_called()
        self.assertEqual(result["total_items_analyzed"], 20)
        self.assertEqual(result["ranking"][0]["name"], "dior")

    def test_analyze_trends_uses_selective_scroll_for_non_facet_dimensions(self):
        points = [
            SimpleNamespace(payload={"quarter": "秋冬"}),
            SimpleNamespace(payload={"quarter": "秋冬"}),
        ]

        with patch("backend.app.agent.tools.get_collection", return_value="fashion_items"), patch(
            "backend.app.agent.tools.get_qdrant", return_value=object()
        ), patch("backend.app.agent.tools.build_qdrant_filter", return_value=None), patch(
            "backend.app.agent.tools.iter_scroll", return_value=iter(points)
        ) as mock_iter_scroll:
            result = json.loads(
                analyze_trends.invoke(
                    {"dimension": "quarter", "top_n": 5},
                    config=self.config,
                )
            )

        self.assertEqual(result["total_items_analyzed"], 2)
        self.assertEqual(result["ranking"][0]["name"], "秋冬")
        self.assertEqual(result["ranking"][0]["count"], 2)
        self.assertTrue(mock_iter_scroll.called)

    def test_analyze_trends_accepts_json_stringified_list_arguments(self):
        captured: dict[str, object] = {}

        def _fake_build_qdrant_filter(**kwargs):
            captured.update(kwargs)
            return None

        with patch("backend.app.agent.tools.get_collection", return_value="fashion_items"), patch(
            "backend.app.agent.tools.get_qdrant", return_value=object()
        ), patch("backend.app.agent.tools.build_qdrant_filter", side_effect=_fake_build_qdrant_filter), patch(
            "backend.app.agent.tools.iter_scroll", return_value=iter([])
        ):
            result = json.loads(
                analyze_trends.invoke(
                    {"dimension": "brand", "categories": '["jacket"]', "quarter": '["fw"]', "top_n": 5},
                    config=self.config,
                )
            )

        self.assertEqual(result["total_items_analyzed"], 0)
        self.assertEqual(captured["categories"], ["jacket"])
        self.assertEqual(captured["quarter"], ["秋冬"])

    @patch("backend.app.agent.tools.set_session_agent_runtime")
    @patch("backend.app.agent.tools.count_session", return_value=120)
    @patch("backend.app.agent.tools.apply_aesthetic_boost", side_effect=lambda vector: vector)
    @patch("backend.app.agent.tools.encode_text", return_value=[0.1, 0.2, 0.3])
    def test_start_collection_persists_runtime_state(
        self,
        mock_encode_text,
        mock_apply_aesthetic_boost,
        mock_count,
        mock_set_runtime,
    ):
        config = {"configurable": {"thread_id": "user-1:session-1"}}
        set_runtime_plan(
            "user-1:session-1",
            build_runtime_plan(
                query_text="blue dress",
                has_images=False,
                session_preferences={"gender": "female", "quarter": "fw", "year": 2024},
            ),
        )
        start_collection.func("blue dress", config=config)

        self.assertTrue(mock_set_runtime.called)
        session_id, persisted = mock_set_runtime.call_args.args
        self.assertEqual(session_id, "session-1")
        self.assertEqual(persisted["search_session"]["query"], "blue dress")
        self.assertTrue(persisted["search_session"]["active"])
        self.assertEqual(persisted["runtime_plan"]["default_category"], "dress")
        self.assertEqual(persisted["runtime_plan"]["hard_filters"][0]["dimension"], "gender")

    @patch("backend.app.routers.chat.get_session_agent_runtime")
    def test_restore_agent_session_from_runtime_hydrates_session_and_semantics(self, mock_runtime):
        mock_runtime.return_value = {
            "search_session": {
                "query": "blue dress",
                "vector_type": "fashion_clip",
                "q_emb": [0.1, 0.2, 0.3],
                "filters": [{"type": "garment_tag", "key": "dress:color", "value": "dress:blue"}],
                "active": True,
            },
            "semantics": {"primary_category": "dress"},
            "runtime_plan": {
                "goal_type": "category_lookup",
                "search_strategy": "semantic_with_category_guardrail",
                "default_category": "dress",
                "hard_filters": [{"dimension": "quarter", "value": "fw", "source": "session_preference"}],
                "policy_flags": {"duplicate_filters_are_noop": True},
            },
        }
        restored = _restore_agent_session_from_runtime_state(
            session_id="session-1",
            thread_id=self.thread_id,
        )

        hydrated = get_session(self.config)
        self.assertEqual(restored["query"], "blue dress")
        self.assertTrue(hydrated["active"])
        self.assertEqual(hydrated["filters"][0]["key"], "dress:color")
        self.assertEqual(_session_semantics[self.thread_id]["primary_category"], "dress")
        self.assertEqual(_runtime_plans[self.thread_id]["default_category"], "dress")
        self.assertEqual(_runtime_plans[self.thread_id]["hard_filters"][0]["value"], normalize_quarter_value("fw"))

    def test_build_runtime_plan_promotes_preferences_and_category(self):
        plan = build_runtime_plan(
            query_text="我想看连衣裙",
            has_images=False,
            session_preferences={"gender": "female", "quarter": "fw", "year": 2023},
        )

        hard_filters = {(item["dimension"], item["value"]) for item in plan["hard_filters"]}
        self.assertEqual(plan["default_category"], "dress")
        self.assertIn(("category", "dress"), hard_filters)
        self.assertIn(("gender", "female"), hard_filters)
        self.assertIn(("quarter", "秋冬"), hard_filters)
        self.assertIn(("year_min", 2023), hard_filters)
        self.assertEqual(plan["next_step_hint"], "start_collection")

    @patch("backend.app.agent.tools.count_session", return_value=18)
    @patch("backend.app.agent.tools.encode_text", return_value=[0.1, 0.2, 0.3])
    def test_start_collection_seeds_runtime_plan_hard_filters(self, mock_encode_text, mock_count):
        config = {"configurable": {"thread_id": "user-3:session-3"}}
        set_runtime_plan(
            "user-3:session-3",
            build_runtime_plan(
                query_text="找连衣裙",
                has_images=False,
                session_preferences={"gender": "female", "quarter": "fw"},
            ),
        )

        with patch("backend.app.agent.tools.get_qdrant", return_value=object()):
            payload = json.loads(start_collection.func("dress", config=config))

        stored_session = get_session(config)
        self.assertEqual(payload["status"], "collection_started")
        self.assertIn("category=dress", payload["seeded_filters"])
        self.assertIn("gender=female", payload["seeded_filters"])
        self.assertIn("quarter=秋冬", payload["seeded_filters"])
        self.assertEqual(payload["recommended_next_step"], "add_filter")
        self.assertNotIn("style_rich_text_used", payload)
        self.assertEqual(stored_session["filters"][0]["type"], "meta")

    @patch("backend.app.agent.tools.count_session", side_effect=[12, 12])
    def test_add_filter_returns_noop_when_duplicate_filter_is_already_active(self, mock_count):
        session = {
            "query": "dress",
            "vector_type": "fashion_clip",
            "q_emb": [0.1, 0.2, 0.3],
            "filters": [{"type": "meta", "key": "brand", "value": "Akris"}],
            "active": True,
        }
        set_session(self.config, session)
        set_runtime_plan(
            self.thread_id,
            {
                "goal_type": "brand_focus",
                "search_strategy": "semantic_browse",
                "hard_filters": [],
                "policy_flags": {"duplicate_filters_are_noop": True},
            },
        )

        with patch("backend.app.agent.tools.get_qdrant", return_value=object()):
            payload = json.loads(add_filter.func("brand", "Akris", config=self.config))

        self.assertEqual(payload["action"], "filter_already_active")
        self.assertEqual(len(get_session(self.config)["filters"]), 1)

    def test_build_runtime_plan_blocks_trend_analysis_for_brand_only_flow(self):
        plan = build_runtime_plan(
            query_text="我只想看 Akris 这个品牌",
            has_images=False,
            session_active=True,
        )

        self.assertEqual(plan["next_step_hint"], "add_brand_filter")
        self.assertIn("analyze_trends", plan["blocked_tools"])

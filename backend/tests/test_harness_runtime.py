import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from backend.app.agent.tools import add_filter, analyze_trends, start_collection
from backend.app.agent.session_state import set_session, get_session
from backend.app.agent.harness import (
    _session_semantics,
    build_turn_context,
    set_turn_context,
    clear_turn_context,
)
from backend.app.routers.chat import _restore_agent_session_from_runtime_state
from backend.app.config import settings


class HarnessRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.config = {"configurable": {"thread_id": "test-harness-runtime"}}
        self.thread_id = self.config["configurable"]["thread_id"]

    def tearDown(self):
        clear_turn_context(self.thread_id)
        _session_semantics.clear()

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
            SimpleNamespace(payload={"quarter": "秋冬", "season": ["fall-winter"]}),
            SimpleNamespace(payload={"quarter": "秋冬", "season": ["fall-winter", "resort"]}),
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
    @patch("backend.app.agent.tools.encode_text", return_value=[0.1, 0.2, 0.3])
    def test_start_collection_persists_runtime_state(self, mock_encode_text, mock_count, mock_set_runtime):
        config = {"configurable": {"thread_id": "user-1:session-1"}}
        start_collection.func("blue dress", config=config)

        self.assertTrue(mock_set_runtime.called)
        session_id, persisted = mock_set_runtime.call_args.args
        self.assertEqual(session_id, "session-1")
        self.assertEqual(persisted["search_session"]["query"], "blue dress")
        self.assertTrue(persisted["search_session"]["active"])

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

import json
import unittest
from unittest.mock import patch

from backend.app.agent.tools import add_filter, start_collection
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

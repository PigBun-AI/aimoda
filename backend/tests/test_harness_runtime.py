import json
import unittest
from unittest.mock import patch

from backend.app.agent.tools import add_filter
from backend.app.agent.session_state import set_session
from backend.app.agent.harness import build_turn_context, set_turn_context, clear_turn_context
from backend.app.config import settings


class HarnessRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.config = {"configurable": {"thread_id": "test-harness-runtime"}}
        self.thread_id = self.config["configurable"]["thread_id"]

    def tearDown(self):
        clear_turn_context(self.thread_id)

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

import asyncio

import pytest

from backend.app.agent import sse as sse_module
from backend.app.agent import tools as tools_module
from backend.app.services.chat_run_registry import ChatRunCancelledError, ChatRunRegistry


def test_stream_agent_response_stops_before_processing_next_event(monkeypatch):
    registry = ChatRunRegistry()
    monkeypatch.setattr(sse_module, "chat_run_registry", registry)

    class FakeAgent:
        async def astream_events(self, *_args, **_kwargs):
            yield {
                "event": "on_chat_model_stream",
                "data": {"chunk": type("Chunk", (), {"content": "hello", "tool_call_chunks": []})()},
                "tags": [],
            }

    async def _scenario():
        async def _worker():
            await asyncio.sleep(60)

        task = asyncio.create_task(_worker())
        await registry.register(
            session_id="session-1",
            user_id=7,
            run_id="run-1",
            task=task,
        )
        await registry.stop_session(
            session_id="session-1",
            user_id=7,
            run_id="run-1",
        )

        with pytest.raises(ChatRunCancelledError):
            async for _chunk in sse_module.stream_agent_response(
                agent=FakeAgent(),
                message="hello",
                history=[],
                thread_id="7:session-1:1",
                run_id="run-1",
            ):
                pass

        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(_scenario())


def test_start_collection_honors_stop_requested_before_expensive_work(monkeypatch):
    registry = ChatRunRegistry()
    monkeypatch.setattr(tools_module, "chat_run_registry", registry)
    monkeypatch.setattr(tools_module, "get_qdrant", lambda: (_ for _ in ()).throw(AssertionError("should not call qdrant")))

    async def _scenario():
        async def _worker():
            await asyncio.sleep(60)

        task = asyncio.create_task(_worker())
        await registry.register(
            session_id="session-1",
            user_id=7,
            run_id="run-1",
            task=task,
        )
        await registry.stop_session(
            session_id="session-1",
            user_id=7,
            run_id="run-1",
        )

        with pytest.raises(ChatRunCancelledError):
            tools_module.start_collection.func(
                "minimal black tailoring",
                config={"configurable": {"thread_id": "7:session-1:1", "run_id": "run-1"}},
            )

        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(_scenario())

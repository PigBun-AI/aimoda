import asyncio

from backend.app.services.chat_run_registry import ChatRunRegistry


def test_stop_session_cancels_matching_run():
    async def _scenario():
        registry = ChatRunRegistry()
        started = asyncio.Event()

        async def _worker():
            started.set()
            await asyncio.sleep(60)

        task = asyncio.create_task(_worker())
        await started.wait()
        await registry.register(
            session_id="session-1",
            user_id=7,
            run_id="run-1",
            task=task,
        )

        stopped = await registry.stop_session(
            session_id="session-1",
            user_id=7,
            run_id="run-1",
        )

        assert stopped is True

        try:
            await task
        except asyncio.CancelledError:
            pass

        await asyncio.sleep(0)
        assert await registry.get_session_run("session-1") is None

    asyncio.run(_scenario())


def test_stop_session_rejects_other_users():
    async def _scenario():
        registry = ChatRunRegistry()

        async def _worker():
            await asyncio.sleep(60)

        task = asyncio.create_task(_worker())
        await registry.register(
            session_id="session-1",
            user_id=7,
            run_id="run-1",
            task=task,
        )

        stopped = await registry.stop_session(
            session_id="session-1",
            user_id=8,
            run_id="run-1",
        )

        assert stopped is False
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(_scenario())

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any


@dataclass
class ActiveChatRun:
    session_id: str
    user_id: int
    run_id: str
    task: asyncio.Task[Any]


class ChatRunRegistry:
    """Track active chat runs so explicit stop requests can cancel them safely."""

    def __init__(self) -> None:
        self._by_session: dict[str, ActiveChatRun] = {}
        self._by_run: dict[str, ActiveChatRun] = {}
        self._lock = asyncio.Lock()

    async def register(
        self,
        *,
        session_id: str,
        user_id: int,
        run_id: str,
        task: asyncio.Task[Any],
    ) -> None:
        async with self._lock:
            previous = self._by_session.get(session_id)
            if previous and previous.task is not task and not previous.task.done():
                previous.task.cancel()
                self._by_run.pop(previous.run_id, None)

            active = ActiveChatRun(
                session_id=session_id,
                user_id=user_id,
                run_id=run_id,
                task=task,
            )
            self._by_session[session_id] = active
            self._by_run[run_id] = active

        task.add_done_callback(
            lambda finished_task: asyncio.create_task(
                self._cleanup(session_id=session_id, run_id=run_id, task=finished_task)
            )
        )

    async def stop_session(
        self,
        *,
        session_id: str,
        user_id: int,
        run_id: str | None = None,
    ) -> bool:
        async with self._lock:
            active = self._by_session.get(session_id)
            if not active or active.user_id != user_id:
                return False
            if run_id and active.run_id != run_id:
                return False
            task = active.task

        if task.done():
            return False

        task.cancel()
        return True

    async def get_session_run(self, session_id: str) -> ActiveChatRun | None:
        async with self._lock:
            active = self._by_session.get(session_id)
            if not active or active.task.done():
                return None
            return active

    async def _cleanup(
        self,
        *,
        session_id: str,
        run_id: str,
        task: asyncio.Task[Any],
    ) -> None:
        async with self._lock:
            active = self._by_session.get(session_id)
            if active and active.task is task:
                self._by_session.pop(session_id, None)

            active_by_run = self._by_run.get(run_id)
            if active_by_run and active_by_run.task is task:
                self._by_run.pop(run_id, None)


chat_run_registry = ChatRunRegistry()

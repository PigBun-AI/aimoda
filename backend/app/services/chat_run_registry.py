from __future__ import annotations

import asyncio
from dataclasses import dataclass
import threading
from typing import Optional
from typing import Any


class ChatRunCancelledError(RuntimeError):
    """Raised when a user explicitly stops an active run."""


@dataclass
class ActiveChatRun:
    session_id: str
    user_id: int
    run_id: str
    task: asyncio.Task[Any]
    stop_requested: bool = False


class ChatRunRegistry:
    """Track active chat runs so explicit stop requests can cancel them safely."""

    def __init__(self) -> None:
        self._by_session: dict[str, ActiveChatRun] = {}
        self._by_run: dict[str, ActiveChatRun] = {}
        self._lock = threading.RLock()

    async def register(
        self,
        *,
        session_id: str,
        user_id: int,
        run_id: str,
        task: asyncio.Task[Any],
    ) -> None:
        with self._lock:
            previous = self._by_session.get(session_id)
            if previous and previous.task is not task and not previous.task.done():
                previous.stop_requested = True
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

        task.add_done_callback(lambda finished_task: self._cleanup(session_id=session_id, run_id=run_id, task=finished_task))

    async def stop_session(
        self,
        *,
        session_id: str,
        user_id: int,
        run_id: str | None = None,
    ) -> bool:
        with self._lock:
            active = self._by_session.get(session_id)
            if not active or active.user_id != user_id:
                return False
            if run_id and active.run_id != run_id:
                return False
            task = active.task
            active.stop_requested = True

        if task.done():
            return False

        task.cancel()
        return True

    async def get_session_run(self, session_id: str) -> ActiveChatRun | None:
        with self._lock:
            active = self._by_session.get(session_id)
            if not active or active.task.done():
                return None
            return active

    def get_run(self, *, run_id: str | None = None, session_id: str | None = None) -> Optional[ActiveChatRun]:
        with self._lock:
            if run_id:
                active = self._by_run.get(run_id)
            elif session_id:
                active = self._by_session.get(session_id)
            else:
                active = None
            if not active or active.task.done():
                return None
            return active

    def is_stop_requested(self, *, run_id: str | None = None, session_id: str | None = None) -> bool:
        active = self.get_run(run_id=run_id, session_id=session_id)
        return bool(active and active.stop_requested)

    def raise_if_stop_requested(
        self,
        *,
        run_id: str | None = None,
        session_id: str | None = None,
        stage: str | None = None,
    ) -> None:
        active = self.get_run(run_id=run_id, session_id=session_id)
        if not active or not active.stop_requested:
            return

        detail = f" at {stage}" if stage else ""
        raise ChatRunCancelledError(
            f"Run {active.run_id} was cancelled by the user{detail}."
        )

    def _cleanup(
        self,
        *,
        session_id: str,
        run_id: str,
        task: asyncio.Task[Any],
    ) -> None:
        with self._lock:
            active = self._by_session.get(session_id)
            if active and active.task is task:
                self._by_session.pop(session_id, None)

            active_by_run = self._by_run.get(run_id)
            if active_by_run and active_by_run.task is task:
                self._by_run.pop(run_id, None)


chat_run_registry = ChatRunRegistry()

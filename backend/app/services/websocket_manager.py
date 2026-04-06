"""
WebSocket Connection Manager

Manages active WebSocket connections per user session with Redis Pub/Sub
for broadcasting across multiple API instances.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Callable, Awaitable

import redis.asyncio as redis

from ..config import settings

logger = logging.getLogger(__name__)

# Redis channel for cross-instance broadcasting
_WS_BROADCAST_CHANNEL = "ws:broadcast"


class WebSocketManager:
    """Manages WebSocket connections and Redis Pub/Sub."""

    def __init__(self):
        self._connections: dict[int, list[_ManagedConnection]] = {}
        self._lock = asyncio.Lock()
        self._redis: redis.Redis | None = None
        self._pubsub: redis.client.PubSub | None = None
        self._broadcast_tasks: dict[int, asyncio.Task] = {}

    async def _get_redis(self) -> redis.Redis:
        """Lazily initialize Redis connection."""
        if self._redis is None:
            self._redis = redis.from_url(
                settings.REDIS_DSN,
                encoding="utf-8",
                decode_responses=True,
            )
        return self._redis

    async def connect(
        self,
        user_id: int,
        websocket,
        chat_session_id: str,
        auth_session_id: int | None = None,
    ) -> None:
        """Register a new WebSocket connection."""
        async with self._lock:
            key = user_id
            if key not in self._connections:
                self._connections[key] = []
            self._connections[key].append(
                _ManagedConnection(
                    websocket=websocket,
                    chat_session_id=chat_session_id,
                    auth_session_id=auth_session_id,
                )
            )

        try:
            r = await self._get_redis()
            await r.publish(
                _WS_BROADCAST_CHANNEL,
                json.dumps({
                    "event": "presence",
                    "user_id": user_id,
                    "action": "connected",
                    "session_id": chat_session_id,
                }),
            )
        except Exception as e:
            logger.warning("Redis publish for presence failed: %s", e)

    async def disconnect(self, user_id: int, websocket, chat_session_id: str) -> None:
        """Remove a WebSocket connection."""
        async with self._lock:
            if user_id in self._connections:
                self._connections[user_id] = [
                    connection for connection in self._connections[user_id]
                    if connection.websocket != websocket
                ]
                if not self._connections[user_id]:
                    del self._connections[user_id]

        try:
            r = await self._get_redis()
            await r.publish(
                _WS_BROADCAST_CHANNEL,
                json.dumps({
                    "event": "presence",
                    "user_id": user_id,
                    "action": "disconnected",
                    "session_id": chat_session_id,
                }),
            )
        except Exception as e:
            logger.warning("Redis publish for presence failed: %s", e)

    async def send_to_user(self, user_id: int, message: dict) -> None:
        """Send a JSON-serializable message to all connections of a user."""
        payload = json.dumps(message)
        async with self._lock:
            connections = list(self._connections.get(user_id, []))

        dead = []
        for connection in connections:
            try:
                await connection.websocket.send_text(payload)
            except Exception:
                dead.append(connection.websocket)

        if dead:
            async with self._lock:
                if user_id in self._connections:
                    self._connections[user_id] = [
                        connection for connection in self._connections[user_id]
                        if connection.websocket not in dead
                    ]

    async def revoke_auth_sessions(
        self,
        user_id: int,
        revoked_session_ids: list[int],
        *,
        reason: str = "single_login",
    ) -> None:
        """Notify and close sockets that belong to revoked auth sessions."""
        if not revoked_session_ids:
            return

        payload = {
            "event": "session_revoked",
            "user_id": user_id,
            "session_ids": revoked_session_ids,
            "reason": reason,
        }

        async with self._lock:
            local_matches = [
                connection
                for connection in self._connections.get(user_id, [])
                if connection.auth_session_id in revoked_session_ids
            ]

        for connection in local_matches:
            try:
                await connection.websocket.send_text(json.dumps(payload))
            except Exception:
                pass
            try:
                await connection.websocket.close(code=4001, reason="Session revoked")
            except Exception:
                pass

        await self.broadcast(payload)

    async def broadcast(self, message: dict) -> None:
        """Broadcast a message to all connected users via Redis Pub/Sub."""
        try:
            r = await self._get_redis()
            await r.publish(_WS_BROADCAST_CHANNEL, json.dumps(message))
        except Exception as e:
            logger.warning("Redis broadcast failed: %s", e)

    async def subscribe_broadcast(
        self,
        callback: Callable[[dict], Awaitable[None]],
    ) -> None:
        """Subscribe to Redis broadcast channel and route messages via callback."""
        try:
            r = await self._get_redis()
            self._pubsub = r.pubsub()
            await self._pubsub.subscribe(_WS_BROADCAST_CHANNEL)

            async for raw in self._pubsub.listen():
                if raw["type"] != "message":
                    continue
                try:
                    data = json.loads(raw["data"])
                    await callback(data)
                except Exception as e:
                    logger.error("Broadcast callback error: %s", e)
        except Exception as e:
            logger.warning("Redis subscribe failed: %s", e)

    def get_user_connection_count(self, user_id: int) -> int:
        """Return number of active WebSocket connections for a user."""
        return len(self._connections.get(user_id, []))


@dataclass
class _ManagedConnection:
    websocket: object
    chat_session_id: str
    auth_session_id: int | None


# Global singleton
ws_manager = WebSocketManager()

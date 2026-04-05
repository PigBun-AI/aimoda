import os
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg_pool import AsyncConnectionPool

from ..config import settings
from ..llm_factory import build_llm_with_fallback
from .playbooks import CORE_SYSTEM_PROMPT
from .tools import ALL_TOOLS

SYSTEM_PROMPT = CORE_SYSTEM_PROMPT


# ── Checkpointer (Async PostgreSQL) ──

_pool: AsyncConnectionPool | None = None
_checkpointer: AsyncPostgresSaver | None = None


async def get_checkpointer() -> AsyncPostgresSaver:
    """Get or create async PostgreSQL-backed checkpointer."""
    global _pool, _checkpointer
    if _checkpointer is None:
        _pool = AsyncConnectionPool(
            conninfo=settings.POSTGRES_DSN,
            max_size=5,
            kwargs={"autocommit": True, "prepare_threshold": 0},
        )
        await _pool.open()
        _checkpointer = AsyncPostgresSaver(conn=_pool)
        await _checkpointer.setup()
    return _checkpointer


# ── Agent factory ──

_agent = None


async def get_agent():
    """Get or create the LangGraph ReAct agent with checkpointer."""
    global _agent
    if _agent is None:
        llm = build_llm_with_fallback(
            temperature=settings.LLM_TEMPERATURE,
            max_tokens=settings.LLM_MAX_TOKENS,
        )

        checkpointer = await get_checkpointer()
        _agent = create_react_agent(
            llm,
            ALL_TOOLS,
            prompt=SYSTEM_PROMPT,
            checkpointer=checkpointer,
        )
    return _agent

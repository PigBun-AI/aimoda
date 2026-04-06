from __future__ import annotations

from contextlib import contextmanager

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import settings

_pg_pool: ConnectionPool | None = None


def get_pg_pool() -> ConnectionPool:
    global _pg_pool
    if _pg_pool is None:
        _pg_pool = ConnectionPool(
            conninfo=settings.POSTGRES_DSN,
            min_size=1,
            max_size=8,
            open=False,
            kwargs={
                "autocommit": False,
                "prepare_threshold": 0,
                "row_factory": dict_row,
            },
        )
        _pg_pool.open(wait=True)
    return _pg_pool


@contextmanager
def pg_connection():
    pool = get_pg_pool()
    with pool.connection() as conn:
        yield conn


def close_pg_pool() -> None:
    global _pg_pool
    if _pg_pool is None:
        return
    _pg_pool.close()
    _pg_pool = None

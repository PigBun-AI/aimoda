from __future__ import annotations

import json
from typing import Any

from ..exceptions import AppError


class ReportPackageError(AppError):
    """Structured validation/runtime error for report package processing."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 400,
        *,
        details: dict[str, Any] | None = None,
        retryable: bool = False,
    ):
        super().__init__(message, status_code)
        self.code = code
        self.details = details or None
        self.retryable = retryable

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "retryable": self.retryable,
        }
        if self.details:
            payload["details"] = self.details
        return payload


def build_report_error(
    code: str,
    message: str,
    *,
    details: dict[str, Any] | None = None,
    retryable: bool = False,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "code": code,
        "message": message,
        "retryable": retryable,
    }
    if details:
        payload["details"] = details
    return payload


def error_dict_from_exception(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, ReportPackageError):
        return exc.to_dict()
    if isinstance(exc, AppError):
        return build_report_error("report_upload_failed", exc.message)
    return build_report_error("report_upload_failed", str(exc))


def serialize_report_error(exc: Exception) -> str:
    return json.dumps(error_dict_from_exception(exc), ensure_ascii=False)


def parse_report_error(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return build_report_error("report_upload_failed", raw)

    if isinstance(payload, dict) and isinstance(payload.get("code"), str) and isinstance(payload.get("message"), str):
        return payload

    return build_report_error("report_upload_failed", raw)

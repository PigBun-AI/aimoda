"""Fashion Report Backend — app package."""

from .services.oss_service import OSSService, get_oss_service

__all__ = ["OSSService", "get_oss_service"]

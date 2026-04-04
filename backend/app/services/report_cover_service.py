from __future__ import annotations

import io
import logging

import httpx
from PIL import Image, ImageOps

from ..config import settings
from .oss_service import OSSService, get_oss_service

logger = logging.getLogger(__name__)


def _browserless_screenshot_endpoint() -> str | None:
    base = (settings.REPORT_COVER_BROWSERLESS_URL or "").rstrip("/")
    if not base:
        return None
    return f"{base}/screenshot"


def _normalize_cover_image(image_bytes: bytes) -> bytes:
    with Image.open(io.BytesIO(image_bytes)) as image:
        normalized = image.convert("RGB")
        fitted = ImageOps.fit(
            normalized,
            (settings.REPORT_COVER_WIDTH, settings.REPORT_COVER_HEIGHT),
            method=Image.Resampling.LANCZOS,
            centering=(0.5, 0.0),
        )
        output = io.BytesIO()
        fitted.save(output, format="JPEG", quality=88, optimize=True)
        return output.getvalue()


def _capture_report_cover(index_url: str) -> bytes:
    endpoint = _browserless_screenshot_endpoint()
    if not endpoint:
        raise RuntimeError("REPORT_COVER_BROWSERLESS_URL is not configured")

    params: dict[str, str] = {}
    if settings.REPORT_COVER_BROWSERLESS_TOKEN:
        params["token"] = settings.REPORT_COVER_BROWSERLESS_TOKEN

    payload = {
        "url": index_url,
        "gotoOptions": {
            "waitUntil": "load",
            "timeout": int(settings.REPORT_COVER_TIMEOUT_SECONDS * 1000),
        },
        "waitForSelector": {
            "selector": "img, h1, .hero-image, .report-hero",
            "timeout": min(int(settings.REPORT_COVER_TIMEOUT_SECONDS * 1000), 15000),
            "visible": True,
        },
        "waitForTimeout": 1500,
        "bestAttempt": True,
        "viewport": {
            "width": settings.REPORT_COVER_WIDTH,
            "height": settings.REPORT_COVER_HEIGHT,
            "deviceScaleFactor": 1,
        },
        "options": {
            "type": "png",
            "fullPage": False,
        },
        "addScriptTag": [
            {
                "content": (
                    "document.querySelectorAll('img[loading=\"lazy\"]').forEach((img)=>{img.loading='eager';});"
                    "window.scrollTo(0, 0);"
                )
            }
        ],
        "addStyleTag": [
            {
                "content": (
                    "html,body{margin:0!important;padding:0!important;overflow:hidden!important;"
                    "background:#ffffff!important;}"
                    "img{content-visibility:auto;}"
                )
            }
        ],
    }

    with httpx.Client(timeout=settings.REPORT_COVER_TIMEOUT_SECONDS) as client:
        response = client.post(endpoint, params=params, json=payload)
        response.raise_for_status()
        return response.content


def generate_report_cover(index_url: str, slug: str) -> str | None:
    if not settings.REPORT_COVER_GENERATION_ENABLED:
        return None

    try:
        screenshot = _capture_report_cover(index_url)
        normalized = _normalize_cover_image(screenshot)
        oss = get_oss_service()
        return oss.upload_file(
            OSSService.report_path(slug, "assets/generated-cover-16x9.jpg"),
            normalized,
            content_type="image/jpeg",
        )
    except Exception as exc:
        logger.warning("Failed to generate report cover for %s: %s", slug, exc)
        return None

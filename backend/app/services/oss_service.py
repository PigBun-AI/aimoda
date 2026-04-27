"""
Aliyun OSS Service

Provides upload, download, and delete operations for files stored in Aliyun OSS.

Path conventions:
  - avatars:       users/{user_id}/avatar/...
  - artifacts:    artifacts/{session_id}/images/...
  - artifacts:    artifacts/{session_id}/reports/...
  - artifacts:    artifacts/{session_id}/tables/...
  - artifacts:    artifacts/{session_id}/code/...
"""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import re
from urllib.parse import urlsplit, urlunsplit
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import BinaryIO

import oss2

from ..config import settings

logger = logging.getLogger(__name__)

_OSS_METADATA_KEY_PATTERN = re.compile(r"[^a-z0-9-]+")

# Artifact storage sub-paths
ARTIFACT_SUBPATHS = {
    "image": "images",
    "report": "reports",
    "table": "tables",
    "code": "code",
    "color_analysis": "color_analysis",
    "trend_chart": "trend_charts",
    "collection_result": "collections",
    "vision_analysis": "vision_analysis",
    "other": "other",
}


class OSSService:
    """Aliyun OSS operations wrapper."""

    def __init__(
        self,
        access_key_id: str | None = None,
        access_key_secret: str | None = None,
        bucket_name: str | None = None,
        endpoint: str | None = None,
    ):
        self.access_key_id = access_key_id or settings.OSS_ACCESS_KEY_ID
        self.access_key_secret = access_key_secret or settings.OSS_ACCESS_KEY_SECRET
        self.bucket_name = bucket_name or settings.OSS_BUCKET_NAME
        self.endpoint = endpoint or settings.OSS_ENDPOINT
        self.endpoint_host = self._normalize_endpoint_host(self.endpoint)
        self.client_endpoint = self._build_endpoint_url(self.endpoint_host)
        self._bucket: oss2.Bucket | None = None
        self._direct_upload_cors_ready = False

    def _get_bucket(self) -> oss2.Bucket:
        if self._bucket is None:
            auth = oss2.Auth(self.access_key_id, self.access_key_secret)
            self._bucket = oss2.Bucket(auth, self.client_endpoint, self.bucket_name)
        return self._bucket

    @staticmethod
    def _normalize_endpoint_host(endpoint: str) -> str:
        parsed = urlsplit(endpoint if "://" in endpoint else f"//{endpoint}")
        return (parsed.netloc or parsed.path).strip("/")

    @staticmethod
    def _build_endpoint_url(endpoint_host: str) -> str:
        scheme = "https" if settings.OSS_USE_HTTPS else "http"
        return f"{scheme}://{endpoint_host}"

    @staticmethod
    def _split_csv(value: str | None, *, fallback: list[str]) -> list[str]:
        if value is None:
            return fallback
        parts = [part.strip() for part in value.split(",")]
        normalized = [part for part in parts if part]
        return normalized or fallback

    @staticmethod
    def _normalize_list(values: list[str] | None) -> list[str]:
        return [str(value).strip() for value in (values or []) if str(value).strip()]

    def _normalize_signed_url(self, signed_url: str) -> str:
        parsed = urlsplit(signed_url)
        scheme = "https" if settings.OSS_USE_HTTPS else (parsed.scheme or "http")
        netloc = parsed.netloc or f"{self.bucket_name}.{self.endpoint_host}"
        return urlunsplit((scheme, netloc, parsed.path, parsed.query, parsed.fragment))

    @staticmethod
    def _cors_rule_matches(rule: oss2.models.CorsRule, desired: oss2.models.CorsRule) -> bool:
        return (
            set(OSSService._normalize_list(getattr(rule, "allowed_origins", None))) == set(OSSService._normalize_list(getattr(desired, "allowed_origins", None)))
            and set(OSSService._normalize_list(getattr(rule, "allowed_methods", None))) == set(OSSService._normalize_list(getattr(desired, "allowed_methods", None)))
            and set(OSSService._normalize_list(getattr(rule, "allowed_headers", None))) == set(OSSService._normalize_list(getattr(desired, "allowed_headers", None)))
            and set(OSSService._normalize_list(getattr(rule, "expose_headers", None))) == set(OSSService._normalize_list(getattr(desired, "expose_headers", None)))
            and int(getattr(rule, "max_age_seconds", 0) or 0) == int(getattr(desired, "max_age_seconds", 0) or 0)
        )

    def ensure_direct_upload_cors(self) -> bool:
        bucket = self._get_bucket()
        desired_rule = oss2.models.CorsRule(
            allowed_origins=self._split_csv(settings.OSS_CORS_ALLOWED_ORIGINS, fallback=["*"]),
            allowed_methods=self._split_csv(settings.OSS_CORS_ALLOWED_METHODS, fallback=["GET", "HEAD", "PUT", "POST"]),
            allowed_headers=self._split_csv(settings.OSS_CORS_ALLOWED_HEADERS, fallback=["*"]),
            expose_headers=self._split_csv(settings.OSS_CORS_EXPOSE_HEADERS, fallback=["ETag", "x-oss-request-id"]),
            max_age_seconds=settings.OSS_CORS_MAX_AGE_SECONDS,
        )

        try:
            current = bucket.get_bucket_cors()
            rules = list(getattr(current, "rules", []) or [])
        except oss2.exceptions.NoSuchCors:
            rules = []

        if any(self._cors_rule_matches(rule, desired_rule) for rule in rules):
            self._direct_upload_cors_ready = True
            return False

        rules.append(desired_rule)
        bucket.put_bucket_cors(oss2.models.BucketCors(rules))
        self._direct_upload_cors_ready = True
        logger.info(
            "Updated OSS bucket CORS for direct browser uploads: origins=%s methods=%s",
            desired_rule.allowed_origins,
            desired_rule.allowed_methods,
        )
        return True

    # ── Path builders ────────────────────────────────────────────────────────────

    @staticmethod
    def avatar_path(user_id: int, filename: str) -> str:
        ext = PurePosixPath(filename).suffix.lower()
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        digest = hashlib.md5(f"{user_id}{timestamp}".encode()).hexdigest()[:8]
        return f"users/{user_id}/avatar/{digest}{ext}"

    @staticmethod
    def artifact_path(
        session_id: str,
        artifact_type: str,
        filename: str,
    ) -> str:
        subpath = ARTIFACT_SUBPATHS.get(artifact_type, "other")
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        digest = hashlib.md5(f"{session_id}{timestamp}".encode()).hexdigest()[:8]
        ext = PurePosixPath(filename).suffix.lower()
        return f"artifacts/{session_id}/{subpath}/{digest}{ext}"

    @staticmethod
    def report_path(slug: str, filename: str) -> str:
        """Build OSS path for report files.

        Examples:
            reports/zimmermann-fall-2026/images/look-01.jpg
            reports/zimmermann-fall-2026/index.html
        """
        return f"reports/{slug}/{filename}"

    @staticmethod
    def report_upload_staging_path(job_id: str, filename: str) -> str:
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", PurePosixPath(filename).name or "report.zip")
        return f"report-uploads/{job_id}/{safe_name}"

    @staticmethod
    def trend_flow_upload_staging_path(job_id: str, filename: str) -> str:
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", PurePosixPath(filename).name or "trend-flow.zip")
        return f"trend-flow-uploads/{job_id}/{safe_name}"

    @staticmethod
    def collection_upload_path(
        user_id: int,
        collection_id: str,
        filename: str,
        content_type: str | None = None,
    ) -> str:
        ext = PurePosixPath(filename).suffix.lower()
        if not ext and content_type:
            ext = mimetypes.guess_extension(content_type) or ".jpg"
        if not ext:
            ext = ".jpg"
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        digest = hashlib.md5(f"{user_id}{collection_id}{filename}{timestamp}".encode()).hexdigest()[:10]
        return f"users/{user_id}/collections/{collection_id}/{digest}{ext}"

    @staticmethod
    def collection_upload_prefix(user_id: int, collection_id: str) -> str:
        return f"users/{user_id}/collections/{collection_id}/"

    # ── Upload ───────────────────────────────────────────────────────────────────

    @staticmethod
    def _build_oss_metadata_headers(metadata: dict | None) -> dict[str, str]:
        """Convert arbitrary metadata keys into OSS-safe x-oss-meta-* headers."""
        if not metadata:
            return {}

        headers: dict[str, str] = {}
        for raw_key, raw_value in metadata.items():
            if raw_value is None:
                continue

            normalized_key = _OSS_METADATA_KEY_PATTERN.sub("-", str(raw_key).strip().lower()).strip("-")
            if not normalized_key:
                continue

            headers[f"x-oss-meta-{normalized_key}"] = str(raw_value)
        return headers

    def upload_file(
        self,
        oss_path: str,
        file_content: BinaryIO | bytes,
        content_type: str | None = None,
        metadata: dict | None = None,
        public_base_url: str | None = None,
    ) -> str:
        """Upload a file and return the OSS URL."""
        bucket = self._get_bucket()

        if content_type is None:
            guessed = mimetypes.guess_type(oss_path)[0]
            content_type = guessed or "application/octet-stream"

        headers = {"Content-Type": content_type}
        headers.update(self._build_oss_metadata_headers(metadata))

        if isinstance(file_content, bytes):
            result = bucket.put_object(oss_path, file_content, headers=headers)
        else:
            result = bucket.put_object(oss_path, file_content.read(), headers=headers)

        if result.status not in (200, 204):
            raise RuntimeError(f"OSS upload failed with status {result.status}")

        return self.get_url(oss_path, public_base_url=public_base_url)

    def upload_avatar(
        self,
        user_id: int,
        file_content: BinaryIO | bytes,
        filename: str,
        content_type: str | None = None,
    ) -> str:
        """Upload a user avatar and return the OSS URL."""
        oss_path = self.avatar_path(user_id, filename)
        return self.upload_file(oss_path, file_content, content_type)

    def upload_artifact(
        self,
        session_id: str,
        artifact_type: str,
        file_content: BinaryIO | bytes,
        filename: str,
        content_type: str | None = None,
        metadata: dict | None = None,
    ) -> str:
        """Upload an artifact file and return the OSS URL."""
        oss_path = self.artifact_path(session_id, artifact_type, filename)
        return self.upload_file(oss_path, file_content, content_type, metadata)

    # ── Download ─────────────────────────────────────────────────────────────────

    def download_file(self, oss_path: str) -> bytes:
        """Download a file from OSS and return its content."""
        bucket = self._get_bucket()
        result = bucket.get_object(oss_path)
        return result.read()

    def download_file_with_meta(self, oss_path: str) -> tuple[bytes, str | None]:
        """Download a file and return (content, content_type)."""
        return self.download_file_with_meta_processed(oss_path)

    def download_file_with_meta_processed(
        self,
        oss_path: str,
        *,
        process: str | None = None,
    ) -> tuple[bytes, str | None]:
        """Download a file and return (content, content_type), optionally via OSS process."""
        bucket = self._get_bucket()
        result = bucket.get_object(oss_path, process=process)
        content = result.read()
        headers = getattr(result, "headers", {}) or {}
        content_type = headers.get("Content-Type") or headers.get("content-type")
        return content, content_type

    def download_file_to_path(self, oss_path: str, destination: str) -> None:
        """Download an OSS object directly to a local file."""
        bucket = self._get_bucket()
        bucket.get_object_to_file(oss_path, destination)

    def get_signed_url(
        self,
        oss_path: str,
        expires_seconds: int = 3600,
    ) -> str:
        """Generate a time-limited signed URL for private buckets."""
        bucket = self._get_bucket()
        return self._normalize_signed_url(bucket.sign_url("GET", oss_path, expires_seconds))

    def get_signed_upload_url(
        self,
        oss_path: str,
        *,
        expires_seconds: int = 900,
        content_type: str = "application/zip",
    ) -> tuple[str, dict[str, str]]:
        """Generate a signed PUT URL for direct-to-OSS uploads."""
        bucket = self._get_bucket()
        if not self._direct_upload_cors_ready:
            try:
                self.ensure_direct_upload_cors()
            except Exception:
                logger.warning("Failed to ensure OSS bucket CORS for direct uploads", exc_info=True)
        headers = {"Content-Type": content_type}
        signed_url = self._normalize_signed_url(bucket.sign_url("PUT", oss_path, expires_seconds, headers=headers))
        return signed_url, headers

    def get_url(self, oss_path: str, public_base_url: str | None = None) -> str:
        """Get the public-facing URL for a file."""
        base_url = (
            public_base_url
            or settings.OSS_PUBLIC_BASE
            or f"https://{self.bucket_name}.{self.endpoint_host}"
        ).rstrip("/")
        parsed = urlsplit(base_url)
        if parsed.scheme and parsed.netloc:
            return f"{base_url}/{oss_path}"
        return f"https://{self.bucket_name}.{self.endpoint_host}/{oss_path}"

    # ── Delete ───────────────────────────────────────────────────────────────────

    def delete_file(self, oss_path: str) -> None:
        """Delete a file from OSS."""
        bucket = self._get_bucket()
        bucket.delete_object(oss_path)

    def delete_prefix(self, prefix: str) -> int:
        """Delete all files under a prefix. Returns count of deleted files."""
        bucket = self._get_bucket()
        count = 0
        for obj in oss2.ObjectIterator(bucket, prefix=prefix):
            bucket.delete_object(obj.key)
            count += 1
        return count

    # ── Exists / Metadata ───────────────────────────────────────────────────────

    def exists(self, oss_path: str) -> bool:
        """Check if a file exists in OSS."""
        bucket = self._get_bucket()
        return bucket.object_exists(oss_path)

    def get_metadata(self, oss_path: str) -> dict | None:
        """Get file metadata (size, content-type, last modified)."""
        bucket = self._get_bucket()
        try:
            meta = bucket.get_object_meta(oss_path)
            return {
                "content_length": meta.content_length,
                "content_type": meta.content_type,
                "last_modified": meta.last_modified,
            }
        except oss2.exceptions.NoSuchKey:
            return None


# Global singleton (lazy — credentials from settings)
_oss_instance: OSSService | None = None


def get_oss_service() -> OSSService:
    global _oss_instance
    if _oss_instance is None:
        _oss_instance = OSSService()
    return _oss_instance

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
from urllib.parse import urlsplit
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import BinaryIO

import oss2

from ..config import settings

logger = logging.getLogger(__name__)

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
        self._bucket: oss2.Bucket | None = None

    def _get_bucket(self) -> oss2.Bucket:
        if self._bucket is None:
            auth = oss2.Auth(self.access_key_id, self.access_key_secret)
            self._bucket = oss2.Bucket(auth, self.endpoint, self.bucket_name)
        return self._bucket

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

    # ── Upload ───────────────────────────────────────────────────────────────────

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
        if metadata:
            for k, v in metadata.items():
                headers[f"x-oss-meta-{k}"] = str(v)

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

    def get_signed_url(
        self,
        oss_path: str,
        expires_seconds: int = 3600,
    ) -> str:
        """Generate a time-limited signed URL for private buckets."""
        bucket = self._get_bucket()
        return bucket.sign_url("GET", oss_path, expires_seconds)

    def get_url(self, oss_path: str, public_base_url: str | None = None) -> str:
        """Get the public-facing URL for a file."""
        base_url = (
            public_base_url
            or settings.OSS_PUBLIC_BASE
            or f"https://{self.bucket_name}.{self.endpoint}"
        ).rstrip("/")
        parsed = urlsplit(base_url)
        if parsed.scheme and parsed.netloc:
            return f"{base_url}/{oss_path}"
        return f"https://{self.bucket_name}.{self.endpoint}/{oss_path}"

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

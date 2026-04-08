from __future__ import annotations

from pydantic import BaseModel, Field, field_validator
from pydantic.alias_generators import to_camel
from typing import Literal
import re

# Type aliases
UserRole = Literal["admin", "editor", "viewer"]
StyleGapStatus = Literal["open", "covered", "ignored"]
RedemptionCodeType = Literal["1week", "1month", "3months", "1year"]
RedemptionCodeStatus = Literal["unused", "used", "expired"]
SubscriptionStatus = Literal["active", "expired"]
ActivityAction = Literal["login", "view_report", "redeem_code", "upload_report"]
ReportUploadJobStatus = Literal["pending", "processing", "completed", "failed"]
FavoriteUploadJobStatus = Literal["pending", "uploading", "queued", "processing", "completed", "partial_failed", "failed"]
FavoriteUploadItemStatus = Literal["pending", "uploaded", "upload_failed", "processing", "completed", "failed"]
UsagePeriodType = Literal["lifetime", "daily"]
FeatureCode = Literal["ai_chat", "fashion_reports", "inspiration", "image_generation", "video_generation"]
SmsPurpose = Literal["login", "register"]

FREE_USER_VIEW_LIMIT = 3

# Simple email regex that allows .local domains
_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


def _validate_email(v: str) -> str:
    if not _EMAIL_RE.match(v):
        raise ValueError("invalid email address")
    return v


class CamelModel(BaseModel):
    """Base model that serializes to camelCase for API responses."""

    model_config = {"populate_by_name": True, "alias_generator": to_camel}


# --- User ---
class UserRecord(CamelModel):
    id: int
    email: str | None = None
    phone: str | None = None
    phone_verified_at: str | None = None
    password_hash: str | None = None
    role: UserRole
    created_at: str
    updated_at: str


class SafeUser(CamelModel):
    id: int
    email: str | None = None
    phone: str | None = None
    role: UserRole
    created_at: str
    updated_at: str


class AuthTokens(BaseModel):
    accessToken: str
    refreshToken: str


class AuthenticatedUser(BaseModel):
    id: int
    email: str | None = None
    phone: str | None = None
    role: UserRole
    session_id: int | None = None


# --- Report ---
class ReportRecord(CamelModel):
    id: int
    slug: str
    title: str
    brand: str
    season: str
    year: int
    look_count: int
    index_url: str
    overview_url: str | None = None
    cover_url: str | None = None
    oss_prefix: str
    uploaded_by: int | None = None
    metadata_json: str | None = None
    created_at: str
    updated_at: str


class ReportMetadata(BaseModel):
    slug: str
    title: str
    brand: str
    season: str
    year: int
    look_count: int
    lead_excerpt: str | None = None


class ReportUploadJobRecord(CamelModel):
    id: str
    filename: str
    status: ReportUploadJobStatus
    uploaded_by: int
    file_size_bytes: int
    source_object_key: str | None = None
    report_id: int | None = None
    report_slug: str | None = None
    error_message: str | None = None
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None


class FavoriteUploadJobItemRecord(CamelModel):
    id: str
    job_id: str
    collection_id: str
    filename: str
    content_type: str
    file_size_bytes: int
    object_key: str
    status: FavoriteUploadItemStatus
    sort_order: int
    error_message: str | None = None
    favorite_item_image_id: str | None = None
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None


class FavoriteUploadJobRecord(CamelModel):
    id: str
    collection_id: str
    user_id: int
    status: FavoriteUploadJobStatus
    total_count: int
    pending_count: int = 0
    uploaded_count: int = 0
    processing_count: int = 0
    completed_count: int = 0
    failed_count: int = 0
    error_message: str | None = None
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None
    items: list[FavoriteUploadJobItemRecord] = Field(default_factory=list)


# --- Redemption Code ---
class RedemptionCodeRecord(CamelModel):
    id: int
    code: str
    type: RedemptionCodeType
    status: RedemptionCodeStatus
    created_by: int
    used_by: int | None
    created_at: str
    used_at: str | None
    expires_at: str


# --- Subscription ---
class SubscriptionRecord(CamelModel):
    id: int
    user_id: int
    starts_at: str
    ends_at: str
    source_code_id: int
    status: SubscriptionStatus
    created_at: str


# --- Activity Log ---
class ActivityLogRecord(CamelModel):
    id: int
    user_id: int
    action: ActivityAction
    created_at: str


# --- Report View ---
class ReportViewRecord(CamelModel):
    id: int
    user_id: int
    report_id: int
    viewed_at: str


# --- Session ---
class SessionRecord(CamelModel):
    id: int
    user_id: int
    refresh_token_hash: str
    device_info: str | None
    ip_address: str | None
    user_agent: str | None
    last_active_at: str
    expires_at: str
    created_at: str


# --- Device Info ---
class DeviceInfo(BaseModel):
    device: str | None = None
    os: str | None = None
    browser: str | None = None
    deviceName: str | None = None


# --- Report View Permission ---
class ReportViewPermission(BaseModel):
    canView: bool
    reason: Literal["allowed", "limit_exceeded", "already_viewed", "subscriber", "subscription_required"]
    viewsRemaining: int
    totalLimit: int


class FeatureUsageRecord(CamelModel):
    id: int
    user_id: int
    feature_code: FeatureCode
    period_type: UsagePeriodType
    period_key: str
    used_count: int
    created_at: str
    updated_at: str


class FeatureAccessStatus(CamelModel):
    feature_code: FeatureCode
    allowed: bool
    reason: Literal["allowed", "limit_exceeded", "subscription_required", "admin", "free_tier", "subscriber"]
    usage_period_type: UsagePeriodType | Literal["none"]
    period_key: str | None = None
    used_count: int = 0
    limit_count: int = -1
    remaining_count: int = -1
    reset_at: str | None = None


# --- Request Schemas ---
class LoginRequest(BaseModel):
    email: str = Field(min_length=1)
    password: str = Field(min_length=8, max_length=72)

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _validate_email(v)


class RegisterRequest(BaseModel):
    email: str = Field(min_length=1)
    password: str = Field(min_length=8, max_length=72)

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _validate_email(v)


class CreateUserRequest(BaseModel):
    email: str = Field(min_length=1)
    password: str = Field(min_length=8, max_length=72)
    role: UserRole

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        return _validate_email(v)


class GenerateCodesRequest(BaseModel):
    type: RedemptionCodeType
    count: int = Field(default=1, ge=1, le=50)


class SmsSendCodeRequest(BaseModel):
    phone: str = Field(min_length=6, max_length=24)
    purpose: SmsPurpose = "login"


class SmsLoginRequest(BaseModel):
    phone: str = Field(min_length=6, max_length=24)
    code: str = Field(min_length=4, max_length=12)


class SmsRegisterRequest(BaseModel):
    phone: str = Field(min_length=6, max_length=24)
    code: str = Field(min_length=4, max_length=12)


class RedeemCodeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class LogoutRequest(BaseModel):
    refreshToken: str | None = None


class UpdateStyleGapRequest(BaseModel):
    status: StyleGapStatus
    linked_style_name: str | None = Field(default=None, max_length=255)
    resolution_note: str | None = Field(default=None, max_length=2000)
    resolved_by: str | None = Field(default=None, max_length=255)


class UpdateAdminReportRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    brand: str | None = Field(default=None, min_length=1, max_length=255)
    season: str | None = Field(default=None, min_length=1, max_length=255)
    year: int | None = Field(default=None, ge=1900, le=2100)
    cover_url: str | None = Field(default=None, max_length=2000)
    lead_excerpt: str | None = Field(default=None, max_length=2000)


class UpdateAdminGalleryRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=4000)
    category: str | None = Field(default=None, min_length=1, max_length=128)
    tags: list[str] | None = None
    cover_url: str | None = Field(default=None, max_length=2000)
    status: str | None = Field(default=None, min_length=1, max_length=32)

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned: list[str] = []
        for item in value:
            normalized = item.strip()
            if not normalized:
                continue
            if len(normalized) > 64:
                raise ValueError("tag is too long")
            cleaned.append(normalized)
        return cleaned

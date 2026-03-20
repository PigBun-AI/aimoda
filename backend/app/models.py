from __future__ import annotations

from pydantic import BaseModel, Field, field_validator
from pydantic.alias_generators import to_camel
from typing import Literal
import re

# Type aliases
UserRole = Literal["admin", "editor", "viewer"]
RedemptionCodeType = Literal["1week", "1month", "3months", "1year"]
RedemptionCodeStatus = Literal["unused", "used", "expired"]
SubscriptionStatus = Literal["active", "expired"]
ActivityAction = Literal["login", "view_report", "redeem_code", "upload_report"]

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
    email: str
    password_hash: str
    role: UserRole
    created_at: str
    updated_at: str


class SafeUser(CamelModel):
    id: int
    email: str
    role: UserRole
    created_at: str
    updated_at: str


class AuthTokens(BaseModel):
    accessToken: str
    refreshToken: str


class AuthenticatedUser(BaseModel):
    id: int
    email: str
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
    path: str
    uploaded_by: int | None
    metadata_json: str | None
    created_at: str
    updated_at: str


class ReportMetadata(BaseModel):
    slug: str
    title: str
    brand: str
    season: str
    year: int
    look_count: int


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
    reason: Literal["allowed", "limit_exceeded", "already_viewed", "subscriber"]
    viewsRemaining: int
    totalLimit: int


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


class RedeemCodeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=32)


class LogoutRequest(BaseModel):
    refreshToken: str | None = None

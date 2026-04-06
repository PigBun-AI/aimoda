import json
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from ..dependencies import get_current_user, extract_device_context
from ..models import (
    AuthenticatedUser,
    LoginRequest,
    LogoutRequest,
    RegisterRequest,
    SmsLoginRequest,
    SmsRegisterRequest,
    SmsSendCodeRequest,
)
from ..services import auth_service
from ..services.websocket_manager import ws_manager

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login")
async def login(body: LoginRequest, request: Request):
    ctx = extract_device_context(request)
    result = auth_service.login(
        email=body.email,
        password=body.password,
        user_agent=ctx["user_agent"],
        ip_address=ctx["ip_address"],
    )
    await ws_manager.revoke_auth_sessions(
        result["user"].id,
        result.get("revoked_session_ids", []),
    )

    response: dict = {
        "success": True,
        "data": {
            "user": result["user"].model_dump(by_alias=True),
            "tokens": result["tokens"].model_dump(by_alias=True),
        },
    }

    if result["kicked_other_devices"]:
        response["message"] = "您已在其他设备登出"

    return response


@router.post("/register", status_code=201)
def register(body: RegisterRequest, request: Request):
    ctx = extract_device_context(request)
    result = auth_service.register(
        email=body.email,
        password=body.password,
        user_agent=ctx["user_agent"],
        ip_address=ctx["ip_address"],
    )

    return {
        "success": True,
        "data": {
            "user": result["user"].model_dump(by_alias=True),
            "tokens": result["tokens"].model_dump(by_alias=True),
        },
    }


@router.post("/sms/send-code")
def send_sms_code(body: SmsSendCodeRequest, request: Request):
    ctx = extract_device_context(request)
    payload = auth_service.send_sms_code(
        phone=body.phone,
        purpose=body.purpose,
        ip_address=ctx["ip_address"],
    )
    return {"success": True, "data": payload}


@router.post("/sms/login")
async def sms_login(body: SmsLoginRequest, request: Request):
    ctx = extract_device_context(request)
    result = auth_service.login_or_register_by_phone(
        phone=body.phone,
        code=body.code,
        user_agent=ctx["user_agent"],
        ip_address=ctx["ip_address"],
    )
    await ws_manager.revoke_auth_sessions(
        result["user"].id,
        result.get("revoked_session_ids", []),
    )

    response: dict = {
        "success": True,
        "data": {
            "user": result["user"].model_dump(by_alias=True),
            "tokens": result["tokens"].model_dump(by_alias=True),
        },
    }

    if result["kicked_other_devices"]:
        response["message"] = "您已在其他设备登出"

    return response


@router.post("/sms/register", status_code=201)
def sms_register(body: SmsRegisterRequest, request: Request):
    ctx = extract_device_context(request)
    result = auth_service.register_by_phone(
        phone=body.phone,
        code=body.code,
        user_agent=ctx["user_agent"],
        ip_address=ctx["ip_address"],
    )

    return {
        "success": True,
        "data": {
            "user": result["user"].model_dump(by_alias=True),
            "tokens": result["tokens"].model_dump(by_alias=True),
        },
    }


@router.get("/me")
def get_me(user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
    safe_user = auth_service.get_current_user(user.id)
    if not safe_user:
        return {"success": False, "error": "用户不存在"}
    return {"success": True, "data": safe_user.model_dump(by_alias=True)}


@router.post("/logout")
def logout(
    body: LogoutRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    if body.refreshToken:
        auth_service.logout(body.refreshToken)
    return {"success": True, "message": "已登出"}


@router.post("/logout-all")
def logout_all(user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
    count = auth_service.logout_all(user.id)
    return {
        "success": True,
        "message": f"已登出 {count} 个设备",
        "data": {"terminatedCount": count},
    }


@router.get("/sessions")
def get_sessions(user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
    sessions = auth_service.get_sessions(user.id)
    safe_sessions = [
        {
            "id": s.id,
            "deviceInfo": json.loads(s.device_info) if s.device_info else None,
            "ipAddress": s.ip_address,
            "lastActiveAt": s.last_active_at,
            "createdAt": s.created_at,
        }
        for s in sessions
    ]
    return {"success": True, "data": safe_sessions}


@router.delete("/sessions/{session_id}")
def terminate_session(
    session_id: int,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    success = auth_service.terminate_session(user.id, session_id)
    if not success:
        return {"success": False, "error": "会话不存在"}
    return {"success": True, "message": "设备已登出"}

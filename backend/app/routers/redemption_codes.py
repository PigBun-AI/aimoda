from typing import Annotated

from fastapi import APIRouter, Depends

from ..dependencies import get_current_user, require_role
from ..models import AuthenticatedUser, GenerateCodesRequest, RedeemCodeRequest
from ..services.redemption_code_service import generate_codes, redeem_code, get_codes

router = APIRouter(tags=["redemption-codes"])


# Admin routes: /api/admin/redemption-codes
admin_router = APIRouter(prefix="/admin/redemption-codes", tags=["admin-redemption-codes"])


@admin_router.post("/", status_code=201)
def create_codes(
    body: GenerateCodesRequest,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    codes = generate_codes(code_type=body.type, count=body.count, created_by=user.id)
    return {"success": True, "data": [c.model_dump(by_alias=True) for c in codes]}


@admin_router.get("/")
def list_codes(user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))]):
    codes = get_codes()
    return {"success": True, "data": [c.model_dump(by_alias=True) for c in codes]}


# User routes: /api/redemption-codes
user_router = APIRouter(prefix="/redemption-codes", tags=["redemption-codes"])


@user_router.post("/redeem")
def redeem(
    body: RedeemCodeRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    subscription = redeem_code(code_str=body.code, user_id=user.id)
    return {"success": True, "data": {"subscription": subscription.model_dump(by_alias=True)}}

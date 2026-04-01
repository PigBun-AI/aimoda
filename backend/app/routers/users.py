from typing import Annotated

from fastapi import APIRouter, Depends

from ..dependencies import get_current_user, require_role
from ..models import AuthenticatedUser, CreateUserRequest
from ..services.user_service import get_users, register_user
from ..services.subscription_service import get_user_subscription

router = APIRouter(prefix="/users", tags=["users"])


@router.get("")
def list_users(user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))]):
    users = get_users()
    return {"success": True, "data": [u.model_dump(by_alias=True) for u in users]}


@router.post("", status_code=201)
def create_user(
    body: CreateUserRequest,
    user: Annotated[AuthenticatedUser, Depends(require_role(["admin"]))],
):
    new_user = register_user(email=body.email, password=body.password, role=body.role)
    return {"success": True, "data": new_user.model_dump(by_alias=True)}


@router.get("/me/subscription")
def get_my_subscription(user: Annotated[AuthenticatedUser, Depends(get_current_user)]):
    subscription = get_user_subscription(user.id)
    return {
        "success": True,
        "data": subscription.model_dump(by_alias=True) if subscription else None,
    }

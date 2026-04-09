from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from ..dependencies import get_current_user
from ..models import AuthenticatedUser
from ..services import favorite_service
from ..services import favorite_upload_job_service

router = APIRouter(prefix="/favorites", tags=["favorites"])


class CreateFavoriteCollectionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str = Field(default="", max_length=240)


class UpdateFavoriteCollectionRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=240)


class AddFavoriteCollectionItemRequest(BaseModel):
    image_id: str = Field(min_length=1, max_length=128)
    image_url: str = Field(min_length=1, max_length=2048)
    brand: str | list[str] | None = Field(default=None)
    year: int | None = None
    quarter: str | list[str] | None = Field(default=None)
    season: str | list[str] | None = Field(default=None)
    gender: str | list[str] | None = Field(default=None)


class PrepareFavoriteUploadFileRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(min_length=1, max_length=120)
    file_size_bytes: int = Field(ge=1, le=10 * 1024 * 1024)


class PrepareFavoriteUploadJobRequest(BaseModel):
    files: list[PrepareFavoriteUploadFileRequest] = Field(min_length=1, max_length=40)


class UploadItemFailedRequest(BaseModel):
    error_message: str = Field(min_length=1, max_length=2000)


class UploadItemUploadedRequest(BaseModel):
    object_key: str | None = Field(default=None, max_length=2048)


class BulkRemoveFavoriteCollectionItemsRequest(BaseModel):
    image_ids: list[str] = Field(min_length=1, max_length=120)


@router.get("/collections")
def list_favorite_collections(
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    return {"success": True, "data": favorite_service.list_collections(user.id)}


@router.get("/collections/lookup")
def lookup_favorite_collections(
    image_id: str = Query(min_length=1),
    user: AuthenticatedUser = Depends(get_current_user),
):
    return {"success": True, "data": favorite_service.list_collections_for_image(user.id, image_id)}


@router.post("/collections")
def create_favorite_collection(
    body: CreateFavoriteCollectionRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    collection = favorite_service.create_collection(
        user.id,
        name=body.name,
        description=body.description,
    )
    return {"success": True, "data": collection}


@router.get("/collections/{collection_id}")
def get_favorite_collection(
    collection_id: str,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=48, ge=1, le=120),
    user: AuthenticatedUser = Depends(get_current_user),
):
    collection = favorite_service.get_collection_detail(user.id, collection_id, offset=offset, limit=limit)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"success": True, "data": collection}


@router.get("/collections/{collection_id}/upload-jobs/active")
def get_active_favorite_collection_upload_job(
    collection_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
):
    job = favorite_upload_job_service.get_active_upload_job(user.id, collection_id)
    return {"success": True, "data": job}


@router.patch("/collections/{collection_id}")
def update_favorite_collection(
    collection_id: str,
    body: UpdateFavoriteCollectionRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    collection = favorite_service.update_collection(
        user.id,
        collection_id,
        name=body.name,
        description=body.description,
    )
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"success": True, "data": collection}


@router.delete("/collections/{collection_id}")
def delete_favorite_collection(
    collection_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    deleted = favorite_service.delete_collection(user.id, collection_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"success": True, "data": {"deleted": True}}


@router.post("/collections/{collection_id}/items")
def add_favorite_collection_item(
    collection_id: str,
    body: AddFavoriteCollectionItemRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    collection = favorite_service.add_item_to_collection(
        user.id,
        collection_id,
        image_id=body.image_id,
        image_url=body.image_url,
        brand=body.brand,
        year=body.year,
        quarter=body.quarter,
        season=body.season,
        gender=body.gender,
    )
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"success": True, "data": collection}


@router.post("/collections/{collection_id}/uploads")
async def upload_favorite_collection_item(
    collection_id: str,
    file: Annotated[UploadFile, File(description="收藏夹自定义参考图")],
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    try:
        file_bytes = await file.read()
        collection = favorite_service.upload_item_to_collection(
            user.id,
            collection_id,
            filename=file.filename,
            content_type=file.content_type,
            file_bytes=file_bytes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"success": True, "data": collection}


@router.post("/collections/{collection_id}/upload-jobs/prepare", status_code=201)
def prepare_favorite_collection_upload_job(
    collection_id: str,
    body: PrepareFavoriteUploadJobRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    try:
        job = favorite_upload_job_service.prepare_upload_job(
            user.id,
            collection_id,
            [item.model_dump() for item in body.files],
        )
    except ValueError as exc:
        message = str(exc)
        status_code = 404 if message == "Collection not found" else 400
        raise HTTPException(status_code=status_code, detail=message) from exc
    return {"success": True, "data": job}


@router.get("/upload-jobs/{job_id}")
def get_favorite_collection_upload_job(
    job_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    job = favorite_upload_job_service.get_upload_job(user.id, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")
    return {"success": True, "data": job}


@router.post("/upload-jobs/{job_id}/items/{item_id}/uploaded")
def mark_favorite_collection_upload_item_uploaded(
    job_id: str,
    item_id: str,
    body: UploadItemUploadedRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    try:
        job = favorite_upload_job_service.mark_upload_item_uploaded(user.id, job_id, item_id, body.object_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=404, detail="Upload job item not found")
    return {"success": True, "data": job}


@router.post("/upload-jobs/{job_id}/items/{item_id}/failed")
def mark_favorite_collection_upload_item_failed(
    job_id: str,
    item_id: str,
    body: UploadItemFailedRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    job = favorite_upload_job_service.mark_upload_item_failed(user.id, job_id, item_id, body.error_message)
    if not job:
        raise HTTPException(status_code=404, detail="Upload job item not found")
    return {"success": True, "data": job}


@router.post("/upload-jobs/{job_id}/complete", status_code=202)
def complete_favorite_collection_upload_job(
    job_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    try:
        job = favorite_upload_job_service.complete_upload_job(user.id, job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=404, detail="Upload job not found")
    return {"success": True, "data": job}


@router.delete("/collections/{collection_id}/items/{image_id}")
def remove_favorite_collection_item(
    collection_id: str,
    image_id: str,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    collection = favorite_service.remove_item_from_collection(user.id, collection_id, image_id)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"success": True, "data": collection}


@router.post("/collections/{collection_id}/items/bulk-delete")
def bulk_remove_favorite_collection_items(
    collection_id: str,
    body: BulkRemoveFavoriteCollectionItemsRequest,
    user: Annotated[AuthenticatedUser, Depends(get_current_user)],
):
    collection = favorite_service.remove_items_from_collection(user.id, collection_id, body.image_ids)
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"success": True, "data": collection}

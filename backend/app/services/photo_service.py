"""Inspection photo upload, listing and retrieval.

Photos are small enough (10 MB cap) to live inside the MongoDB document as a
base64 string, which keeps Phase 4 free of an object-store dependency.
"""

import base64
from datetime import datetime
from typing import List, Optional, Tuple

from beanie import PydanticObjectId
from fastapi import UploadFile

from app.models.photo import ALLOWED_CONTENT_TYPES, MAX_PHOTO_BYTES, Photo

#: Fallback name when the browser sends a file with no name.
DEFAULT_FILENAME = "photo.jpg"


class PhotoNotFoundError(Exception):
    """Raised when a photo cannot be located."""


class InvalidPhotoError(Exception):
    """Raised when an upload fails validation (type or size)."""


def _to_object_id(value: "PydanticObjectId | str | None") -> Optional[PydanticObjectId]:
    if value is None:
        return None
    try:
        return value if isinstance(value, PydanticObjectId) else PydanticObjectId(str(value))
    except Exception:  # noqa: BLE001 - invalid object id string
        return None


def build_photo_payload(photo: Photo) -> dict:
    """Flatten a photo into the shape PhotoResponse expects (no image data)."""
    return {
        "id": str(photo.id),
        "job_id": str(photo.job_id),
        "filename": photo.filename,
        "content_type": photo.content_type,
        "size_bytes": photo.size_bytes,
        "uploaded_by": str(photo.uploaded_by) if photo.uploaded_by else None,
        "uploaded_at": photo.uploaded_at,
    }


async def upload_photo(
    job_id: "PydanticObjectId | str",
    file: UploadFile,
    user_id: PydanticObjectId,
) -> dict:
    """Validate and store an uploaded image against a job."""
    job_oid = _to_object_id(job_id)
    if job_oid is None:
        raise PhotoNotFoundError("Job not found")

    content_type = (file.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        allowed = ", ".join(sorted(ALLOWED_CONTENT_TYPES))
        raise InvalidPhotoError(f"Unsupported image type. Accepted types: {allowed}")

    raw = await file.read()
    if not raw:
        raise InvalidPhotoError("The uploaded file is empty")

    if len(raw) > MAX_PHOTO_BYTES:
        limit_mb = MAX_PHOTO_BYTES // (1024 * 1024)
        raise InvalidPhotoError(f"Photos must be smaller than {limit_mb} MB")

    photo = Photo(
        job_id=job_oid,
        filename=(file.filename or DEFAULT_FILENAME).strip() or DEFAULT_FILENAME,
        content_type=content_type,
        data=base64.b64encode(raw).decode("ascii"),
        size_bytes=len(raw),
        uploaded_by=user_id,
        uploaded_at=datetime.utcnow(),
    )
    await photo.insert()
    return build_photo_payload(photo)


async def list_photos(job_id: "PydanticObjectId | str") -> List[dict]:
    """Return the metadata for every photo attached to a job."""
    job_oid = _to_object_id(job_id)
    if job_oid is None:
        return []

    photos = await Photo.find({"job_id": job_oid}).sort("uploaded_at").to_list()
    return [build_photo_payload(photo) for photo in photos]


async def get_photo(photo_id: "PydanticObjectId | str") -> Photo:
    """Fetch one photo document."""
    oid = _to_object_id(photo_id)
    if oid is None:
        raise PhotoNotFoundError("Photo not found")

    photo = await Photo.get(oid)
    if photo is None:
        raise PhotoNotFoundError("Photo not found")
    return photo


async def get_photo_data(photo_id: "PydanticObjectId | str") -> Tuple[bytes, str, str]:
    """Return ``(image_bytes, content_type, filename)`` ready to stream back."""
    photo = await get_photo(photo_id)
    try:
        raw = base64.b64decode(photo.data, validate=False)
    except Exception as exc:  # noqa: BLE001 - corrupt stored payload
        raise PhotoNotFoundError("This photo could not be read") from exc
    return raw, photo.content_type, photo.filename


async def delete_photo(
    photo_id: "PydanticObjectId | str",
    user_id: Optional[PydanticObjectId] = None,
) -> Photo:
    """Delete a photo document. Caller is responsible for permission checks."""
    photo = await get_photo(photo_id)
    await photo.delete()
    return photo


async def count_photos(job_id: "PydanticObjectId | str") -> int:
    """Count the photos attached to a job."""
    job_oid = _to_object_id(job_id)
    if job_oid is None:
        return 0
    return await Photo.find({"job_id": job_oid}).count()

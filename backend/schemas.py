"""Pydantic request / response schemas for all API endpoints."""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, EmailStr, Field


# ── Chat ─────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    session_id: Optional[str] = None


class SourceCitation(BaseModel):
    source_type: str   # resume | code | repo_summary | profile
    repo_name: str = ""
    section: str = ""


class ChatResponse(BaseModel):
    response: str
    sources: List[SourceCitation] = []
    session_id: str


# ── Calendar / Booking ───────────────────────────────────────────────────────

class AvailabilityRequest(BaseModel):
    timezone: str = "UTC"
    date_from: Optional[str] = None   # ISO 8601
    date_to: Optional[str] = None     # ISO 8601


class BookingRequest(BaseModel):
    name: str = Field(..., min_length=1)
    email: str                         # validated by Cal.com
    start_time: str                    # ISO 8601 e.g. "2025-05-01T10:00:00Z"
    timezone: str = "UTC"
    notes: Optional[str] = None


class BookingResponse(BaseModel):
    uid: str
    title: str
    start_time: str
    confirmation_url: Optional[str] = None


# ── Vapi Voice ───────────────────────────────────────────────────────────────

class VapiMessage(BaseModel):
    type: str
    # The remaining fields vary by message type — keep as open dict
    model_config = {"extra": "allow"}


class VapiWebhookPayload(BaseModel):
    message: Dict[str, Any]

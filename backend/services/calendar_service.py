"""
Calendar Service — Cal.com v2 API integration.

Provides:
  • get_availability()  — fetch open slots for the next N days
  • create_booking()    — create a confirmed meeting
  • format_slots_for_voice() — natural-language slot summary for the voice agent
"""

import logging
import os
from datetime import datetime, timedelta, timezone as _tz
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

_BASE = "https://api.cal.com/v2"
_TIMEOUT = 12.0


class CalendarService:
    def __init__(self) -> None:
        self._api_key = os.getenv("CALCOM_API_KEY", "")
        self._event_slug = os.getenv("CALCOM_EVENT_SLUG", "15-min-interview")
        self._event_type_id: Optional[int] = None

    def _headers(self, api_version: str) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "cal-api-version": api_version,
            "Content-Type": "application/json",
        }

    # ── Public ────────────────────────────────────────────────────────────────

    async def get_availability(
        self,
        tz: str = "UTC",
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Return available slots from Cal.com for the next 7 days."""
        now = datetime.now(_tz.utc)
        start = date_from or now.strftime("%Y-%m-%dT%H:%M:%SZ")
        end = date_to or (now + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")

        event_id = await self._get_event_type_id()
        params = {
            "eventTypeId": event_id,
            "start": start,
            "end": end,
            "timeZone": tz,
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{_BASE}/slots",
                params=params,
                headers=self._headers("2024-09-04"),
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info(f"Slots API response keys: {list(data.keys())}")
            # v2 returns {"data": {"2026-04-14": [{"start": "..."}], ...}}
            # Normalize to {"slots": {"2026-04-14": [{"time": "..."}]}} for frontend
            raw_slots: Dict[str, List[Dict]] = data.get("data", {})
            normalized = {
                date: [{"time": t.get("start", t.get("time", ""))} for t in times]
                for date, times in raw_slots.items()
            }
            return {"slots": normalized}

    async def create_booking(
        self,
        name: str,
        email: str,
        start_time: str,
        tz: str = "UTC",
        notes: str = "",
    ) -> Dict[str, Any]:
        """Create a confirmed booking on Cal.com."""
        event_id = await self._get_event_type_id()
        payload = {
            "eventTypeId": event_id,
            "start": start_time,
            "attendee": {
                "name": name,
                "email": email,
                "timeZone": tz,
                "language": "en",
            },
            "metadata": {"notes": notes} if notes else {},
        }
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(
                f"{_BASE}/bookings",
                json=payload,
                headers=self._headers("2024-08-13"),
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("data", data)

    def format_slots_for_voice(self, availability: Dict[str, Any]) -> str:
        """
        Condense available slots into a short natural-language string
        suitable for reading aloud (≤ 3 days, ≤ 3 slots per day).
        """
        slots: Dict[str, List[Dict]] = availability.get("slots", {})
        if not slots:
            return (
                "It looks like there are no open slots in the next 7 days. "
                "Please try a different week or reach out via email."
            )

        lines: List[str] = []
        for date, times in list(slots.items())[:3]:
            time_strs = [
                t.get("time", "")[:16].replace("T", " at ").replace("-", "/")
                for t in times[:3]
            ]
            lines.append(f"{date}: {', '.join(time_strs)}")

        return "I have these slots open: " + "; ".join(lines) + ". Which works for you?"

    # ── Private ───────────────────────────────────────────────────────────────

    async def _get_event_type_id(self) -> int:
        """Resolve the event type slug to its numeric ID (cached)."""
        if self._event_type_id is not None:
            return self._event_type_id

        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{_BASE}/event-types",
                headers=self._headers("2024-06-14"),
            )
            resp.raise_for_status()
            data = resp.json()
            logger.info(f"Event types raw: {str(data)[:500]}")

        # v2 response: {"status":"success","data":{"eventTypeGroups":[{"eventTypes":[...]}]}}
        # or:          {"status":"success","data":[...]}
        payload = data.get("data", {})

        # flatten all event types from both possible shapes
        event_types: List[Dict] = []
        if isinstance(payload, list):
            event_types = payload
        elif isinstance(payload, dict):
            for group in payload.get("eventTypeGroups", []):
                event_types.extend(group.get("eventTypes", []))
            # also check top-level eventTypes key
            event_types.extend(payload.get("eventTypes", []))

        for et in event_types:
            if et.get("slug") == self._event_slug:
                self._event_type_id = int(et["id"])
                logger.info(
                    f"Resolved event slug '{self._event_slug}' → id={self._event_type_id}"
                )
                return self._event_type_id

        raise ValueError(
            f"Cal.com event type with slug '{self._event_slug}' not found. "
            f"Found slugs: {[e.get('slug') for e in event_types]}. "
            "Check CALCOM_EVENT_SLUG in .env and verify the event exists on Cal.com."
        )

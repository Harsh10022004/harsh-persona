"""
Voice Service — Vapi.ai webhook and custom-LLM endpoint logic.

Handles three Vapi message types:
  • assistant-request   → return full assistant configuration
  • function-call       → check_availability | book_meeting
  • end-of-call-report  → log call summary

Also serves the custom OpenAI-compatible /vapi/llm endpoint that
Vapi calls for each conversational turn (RAG-backed, < 2 s target).
"""

import logging
import os
from typing import Any, Dict, List, Tuple

from backend.services.rag_service import RAGService
from backend.services.calendar_service import CalendarService

logger = logging.getLogger(__name__)

_USER_NAME = os.getenv("USER_NAME", "Harsh_Vardhan_Singhania").replace("_", " ")
_BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

# Vapi function definitions exposed to the voice LLM
_FUNCTIONS = [
    {
        "name": "check_availability",
        "description": (
            "Check Harsh's calendar and return available meeting slots. "
            "Call this when the caller asks about scheduling, availability, or "
            "wants to book a meeting."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "timezone": {
                    "type": "string",
                    "description": "Caller's IANA timezone, e.g. 'America/New_York'",
                }
            },
        },
    },
    {
        "name": "book_meeting",
        "description": "Create a confirmed calendar booking with the caller.",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Caller's full name"},
                "email": {"type": "string", "description": "Caller's email address"},
                "start_time": {
                    "type": "string",
                    "description": "ISO 8601 start time, e.g. '2025-05-10T14:00:00Z'",
                },
                "timezone": {
                    "type": "string",
                    "description": "Caller's IANA timezone",
                },
            },
            "required": ["name", "email", "start_time"],
        },
    },
]


class VoiceService:
    def __init__(self) -> None:
        self.rag = RAGService()
        self.calendar = CalendarService()

    # ── Vapi webhook handlers ─────────────────────────────────────────────────

    def get_assistant_config(self) -> Dict[str, Any]:
        """
        Return the Vapi assistant object.

        Vapi calls this endpoint on every new inbound call
        (message.type == "assistant-request").
        """
        return {
            "assistant": {
                "name": f"{_USER_NAME} AI Representative",
                "firstMessage": (
                    f"Hello! I'm the AI representative of {_USER_NAME}, a software engineer. "
                    "I can tell you about his background, projects, and skills — "
                    "and I can book an interview slot directly. How can I help you today?"
                ),
                "model": {
                    "provider": "custom-llm",
                    "url": f"{_BACKEND_URL}/vapi/llm",
                    "model": "harsh-persona-rag",
                },
                "voice": {
                    "provider": "11labs",
                    "voiceId": "adam",      # professional male voice
                    "stability": 0.5,
                    "similarityBoost": 0.75,
                },
                "transcriber": {
                    "provider": "deepgram",
                    "model": "nova-2",
                    "language": "en-US",
                },
                "functions": _FUNCTIONS,
                "silenceTimeoutSeconds": 30,
                "maxDurationSeconds": 600,
                "serverUrl": f"{_BACKEND_URL}/voice",
                "serverMessages": ["function-call", "end-of-call-report"],
                "endCallMessage": (
                    "It was great speaking with you! "
                    "You'll receive a calendar confirmation if we booked a slot. "
                    "Have a great day!"
                ),
            }
        }

    async def handle_function_call(
        self, function_name: str, parameters: Dict[str, Any]
    ) -> str:
        """Dispatch Vapi function calls to the appropriate service."""
        if function_name == "check_availability":
            try:
                tz = parameters.get("timezone", "UTC")
                avail = await self.calendar.get_availability(tz=tz)
                return self.calendar.format_slots_for_voice(avail)
            except Exception as exc:
                logger.error(f"check_availability error: {exc}")
                return (
                    "I'm having trouble reading the calendar right now. "
                    "Please try again in a moment or visit the chat interface."
                )

        if function_name == "book_meeting":
            try:
                booking = await self.calendar.create_booking(
                    name=parameters["name"],
                    email=parameters["email"],
                    start_time=parameters["start_time"],
                    tz=parameters.get("timezone", "UTC"),
                )
                uid = booking.get("uid", "")
                return (
                    f"All set! I've booked the meeting. "
                    f"A confirmation email is on its way to {parameters['email']}. "
                    f"Reference: {uid}."
                )
            except Exception as exc:
                logger.error(f"book_meeting error: {exc}")
                return (
                    "I ran into an issue creating the booking. "
                    "Please use the chat interface to complete the scheduling."
                )

        logger.warning(f"Unknown function call: {function_name}")
        return "I don't know how to handle that request."

    def handle_end_of_call(self, message: Dict[str, Any]) -> None:
        reason = message.get("endedReason", "unknown")
        duration = message.get("durationSeconds", 0)
        logger.info(f"Call ended — reason={reason}, duration={duration}s")

    # ── Custom LLM endpoint (OpenAI-compatible) ───────────────────────────────

    async def handle_llm_request(self, messages: List[Dict[str, Any]]) -> str:
        """
        Called by Vapi for each conversational turn via /vapi/llm.

        Extracts the latest user question, runs RAG, and returns a
        voice-optimised (concise) answer.
        """
        user_msgs = [m for m in messages if m.get("role") == "user"]
        if not user_msgs:
            return f"Hello! I'm {_USER_NAME}'s AI. What would you like to know?"

        question = user_msgs[-1].get("content", "").strip()
        history = _extract_history(messages)

        answer, _ = self.rag.query(question, history=history)

        # Trim to ≈ 3 sentences for voice readability
        return _trim_for_voice(answer)


# ── Module-level helpers ──────────────────────────────────────────────────────

def _extract_history(
    messages: List[Dict[str, Any]],
) -> List[Tuple[str, str]]:
    """Build (user, assistant) turn pairs from the Vapi messages list."""
    pairs: List[Tuple[str, str]] = []
    i = 0
    while i < len(messages) - 1:
        if messages[i].get("role") == "user":
            user_txt = messages[i].get("content", "")
            asst_txt = messages[i + 1].get("content", "") if messages[i + 1].get("role") == "assistant" else ""
            if asst_txt:
                pairs.append((user_txt, asst_txt))
                i += 2
                continue
        i += 1
    return pairs[-5:]   # last 5 turns max


def _trim_for_voice(text: str, max_sentences: int = 3) -> str:
    """Keep only the first max_sentences sentences for voice delivery."""
    import re
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return " ".join(sentences[:max_sentences])

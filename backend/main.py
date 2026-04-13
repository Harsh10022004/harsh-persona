"""
FastAPI Application — Harsh Persona Orchestrator

Routes
------
GET  /health              — liveness probe
POST /chat                — RAG chat (frontend)
POST /voice               — Vapi.ai webhook (assistant-request, function-call, end-of-call)
POST /vapi/llm            — Custom LLM endpoint (OpenAI-compatible, called by Vapi per turn)
GET  /availability        — Cal.com available slots
POST /book                — Create a Cal.com booking

All services are lazy-loaded and warm-up is triggered at startup to hit
< 2 s first-response latency on voice calls.
"""

import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Load .env before importing services that read os.getenv
load_dotenv(Path(__file__).parent.parent / ".env")

from backend.schemas import (
    BookingRequest,
    ChatRequest,
    ChatResponse,
    SourceCitation,
)
from backend.services.calendar_service import CalendarService
from backend.services.rag_service import RAGService
from backend.services.voice_service import VoiceService

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# ── Singletons ────────────────────────────────────────────────────────────────
# Services are instantiated once and shared across requests.

_rag: RAGService | None = None
_voice: VoiceService | None = None
_calendar: CalendarService | None = None


def rag() -> RAGService:
    global _rag
    if _rag is None:
        _rag = RAGService()
    return _rag


def voice() -> VoiceService:
    global _voice
    if _voice is None:
        _voice = VoiceService()
    return _voice


def calendar() -> CalendarService:
    global _calendar
    if _calendar is None:
        _calendar = CalendarService()
    return _calendar


# ── Lifespan (startup warm-up) ────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Warm up the RAG pipeline at startup so the first Vapi call doesn't
    incur a cold-start penalty (Pinecone connection + embeddings model load).
    """
    logger.info("Starting warm-up ...")
    try:
        rag().warm_up()
        logger.info("Warm-up complete — Pinecone connection established.")
    except Exception as exc:
        logger.warning(f"Warm-up failed (service will still start): {exc}")
    yield
    logger.info("Shutting down.")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Harsh Persona Orchestrator",
    version="1.0.0",
    description="RAG-backed AI persona for Harsh Vardhan Singhania",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["ops"])
async def health():
    """Liveness probe — returns current LLM provider."""
    import os
    return {"status": "ok", "llm_provider": os.getenv("LLM_PROVIDER", "GEMINI")}


@app.post("/chat", response_model=ChatResponse, tags=["chat"])
async def chat(req: ChatRequest):
    """
    RAG-backed chat endpoint consumed by the Next.js frontend.

    Accepts an optional session_id to thread conversations (history
    is managed client-side and passed back via the message context
    for now; a Redis store can be wired in later).
    """
    session_id = req.session_id or str(uuid.uuid4())
    try:
        answer, docs = rag().query(req.message)
    except Exception as exc:
        logger.error(f"RAG query failed: {exc}")
        raise HTTPException(status_code=500, detail="Knowledge retrieval failed.")

    sources = [
        SourceCitation(
            source_type=d.metadata.get("source_type", ""),
            repo_name=d.metadata.get("repo_name", ""),
            section=d.metadata.get("section", ""),
        )
        for d in docs[:3]
    ]
    return ChatResponse(response=answer, sources=sources, session_id=session_id)


@app.post("/voice", tags=["voice"])
async def voice_webhook(request: Request):
    """
    Vapi.ai server-side webhook.

    Vapi sends POST requests here for:
      - assistant-request  (new call starts → return assistant config)
      - function-call      (AI invoked a tool → execute and return result)
      - end-of-call-report (call finished → log it)
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    message = body.get("message", {})
    msg_type = message.get("type", "")

    if msg_type == "assistant-request":
        return JSONResponse(voice().get_assistant_config())

    if msg_type == "function-call":
        fn_call = message.get("functionCall", {})
        fn_name = fn_call.get("name", "")
        params = fn_call.get("parameters", {})
        result = await voice().handle_function_call(fn_name, params)
        return JSONResponse({"result": result})

    if msg_type == "end-of-call-report":
        voice().handle_end_of_call(message)
        return JSONResponse({"status": "received"})

    # Unknown message types — acknowledge silently
    return JSONResponse({"status": "ok"})


@app.post("/vapi/llm", tags=["voice"])
async def vapi_llm(request: Request):
    """
    Custom LLM endpoint (OpenAI chat-completion compatible).

    Vapi calls this on every conversational turn instead of hitting
    OpenAI/Gemini directly, giving us full RAG control and < 2 s latency.
    """
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    messages = body.get("messages", [])
    response_text = await voice().handle_llm_request(messages)

    # OpenAI-compatible response envelope
    return JSONResponse(
        {
            "id": f"chatcmpl-{uuid.uuid4().hex[:8]}",
            "object": "chat.completion",
            "model": "harsh-persona-rag",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": response_text},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }
    )


@app.get("/availability", tags=["calendar"])
async def get_availability(tz: str = "UTC"):
    """Return open Cal.com slots for the next 7 days."""
    try:
        return await calendar().get_availability(tz=tz)
    except Exception as exc:
        logger.error(f"Availability fetch failed: {exc}")
        raise HTTPException(status_code=502, detail=str(exc))


@app.post("/book", tags=["calendar"])
async def book_meeting(req: BookingRequest):
    """Create a confirmed Cal.com booking."""
    try:
        result = await calendar().create_booking(
            name=req.name,
            email=req.email,
            start_time=req.start_time,
            tz=req.timezone,
            notes=req.notes or "",
        )
        return result
    except Exception as exc:
        logger.error(f"Booking failed: {exc}")
        raise HTTPException(status_code=502, detail=str(exc))

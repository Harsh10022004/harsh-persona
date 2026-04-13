"""
Centralised configuration — reads from .env once at import time.
All other modules import from here instead of calling os.getenv directly.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Always load from the repo root .env regardless of CWD
_env_path = Path(__file__).parent.parent / ".env"
load_dotenv(_env_path)


class _Config:
    # LLM
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "GEMINI").upper()
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    MODEL_NAME: str = os.getenv("MODEL_NAME", "gemini-1.5-flash")
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    OPENAI_MODEL: str = os.getenv("OPENAI_MODEL", "gpt-4o")
    OPENAI_EMBEDDING_MODEL: str = os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")

    # Pinecone
    PINECONE_API_KEY: str = os.getenv("PINECONE_API_KEY", "")
    PINECONE_INDEX_NAME: str = os.getenv("PINECONE_INDEX_NAME", "harsh-persona-index")

    # Cal.com
    CALCOM_API_KEY: str = os.getenv("CALCOM_API_KEY", "")
    CALCOM_EVENT_SLUG: str = os.getenv("CALCOM_EVENT_SLUG", "15-min-interview")

    # Vapi
    VAPI_PRIVATE_KEY: str = os.getenv("VAPI_PRIVATE_KEY", "")

    # GitHub
    GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")

    # Identity
    USER_NAME: str = os.getenv("USER_NAME", "Harsh_Vardhan_Singhania").replace("_", " ")
    RESUME_PATH: Path = Path(os.getenv("RESUME_PATH", "./data/HarshResume.pdf"))

    # Deployment
    BACKEND_URL: str = os.getenv("BACKEND_URL", "http://localhost:8000")


config = _Config()

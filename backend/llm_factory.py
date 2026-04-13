"""
LLM Factory — always uses Groq for LLM, Gemini REST for embeddings.

No LLM_PROVIDER switching needed. Keys read directly from .env:
  GROQ_API_KEY   → llama-3.3-70b-versatile
  GOOGLE_API_KEY → text-embedding-004 (768-dim, via REST)
"""

import os
from functools import lru_cache
from typing import List

from langchain_core.embeddings import Embeddings


# ── Gemini REST Embeddings ────────────────────────────────────────────────────

class _GeminiRestEmbeddings(Embeddings):
    """Direct REST call to Gemini embedding API — no SDK, no version issues."""
    _URL = (
        "https://generativelanguage.googleapis.com"
        "/v1beta/models/gemini-embedding-001:embedContent"
    )

    def __init__(self, api_key: str):
        self._api_key = api_key

    def embed_query(self, text: str) -> List[float]:
        import httpx
        resp = httpx.post(
            self._URL,
            params={"key": self._api_key},
            json={"model": "models/gemini-embedding-001",
                  "content": {"parts": [{"text": text}]},
                  "outputDimensionality": 768},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["embedding"]["values"]

    _BATCH_URL = (
        "https://generativelanguage.googleapis.com"
        "/v1beta/models/gemini-embedding-001:batchEmbedContents"
    )
    _BATCH_SIZE = 10   # texts per request
    _BATCH_DELAY = 6.0 # seconds between batches → 10 req/min, well under limits

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        import httpx, time, logging
        log = logging.getLogger(__name__)
        results: List[List[float]] = []
        for i in range(0, len(texts), self._BATCH_SIZE):
            batch = texts[i : i + self._BATCH_SIZE]
            payload = {
                "requests": [
                    {
                        "model": "models/gemini-embedding-001",
                        "content": {"parts": [{"text": t}]},
                        "outputDimensionality": 768,
                    }
                    for t in batch
                ]
            }
            # Retry up to 5 times with backoff on 429
            wait = 60
            for attempt in range(5):
                resp = httpx.post(
                    self._BATCH_URL,
                    params={"key": self._api_key},
                    json=payload,
                    timeout=60,
                )
                if resp.status_code == 429:
                    log.warning(f"Gemini 429 — waiting {wait}s before retry (attempt {attempt+1}/5)")
                    time.sleep(wait)
                    wait *= 2
                    continue
                resp.raise_for_status()
                break
            for emb in resp.json().get("embeddings", []):
                results.append(emb["values"])
            if i + self._BATCH_SIZE < len(texts):
                time.sleep(self._BATCH_DELAY)
        return results


# ── LLM (always Groq) ─────────────────────────────────────────────────────────

def get_llm(temperature: float = 0.2):
    from langchain_groq import ChatGroq
    return ChatGroq(
        model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
        api_key=os.getenv("GROQ_API_KEY"),
        temperature=temperature,
    )


# ── Embeddings (always Gemini REST) ───────────────────────────────────────────

@lru_cache(maxsize=1)
def get_embeddings():
    from langchain_community.embeddings import HuggingFaceEmbeddings
    return HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-mpnet-base-v2",
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )


def get_embedding_dimension() -> int:
    return 768  # all-mpnet-base-v2

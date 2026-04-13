"""
Vector Store — Step 5 (final) of the ingestion pipeline.

Initialises the Pinecone serverless index and bulk-uploads all Documents
in batches, respecting token limits and metadata constraints.
Also exposes get_vector_store() for the backend to call at query time.
"""

import logging
import os
import time
from typing import List

from langchain_core.documents import Document

logger = logging.getLogger(__name__)

_BATCH_SIZE = 80          # documents per upsert batch
_MAX_DOC_CHARS = 8_000    # truncate page_content above this length


# ── Upload ────────────────────────────────────────────────────────────────────

def upload_documents(documents: List[Document]) -> None:
    """
    Upload documents to Pinecone.

    Creates the index if it doesn't exist, then upserts in batches.
    """
    if not documents:
        logger.warning("upload_documents called with an empty list — nothing to do.")
        return

    from pinecone import Pinecone
    from langchain_pinecone import PineconeVectorStore

    # Import factory here (env already loaded by caller)
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from backend.llm_factory import get_embeddings, get_embedding_dimension

    index_name = os.getenv("PINECONE_INDEX_NAME", "harsh-persona-index")
    api_key = os.getenv("PINECONE_API_KEY", "")

    pc = Pinecone(api_key=api_key)
    _ensure_index(pc, index_name, get_embedding_dimension())

    embeddings = get_embeddings()
    valid_docs = _clean_documents(documents)

    logger.info(f"Uploading {len(valid_docs)} documents in batches of {_BATCH_SIZE} ...")

    for i in range(0, len(valid_docs), _BATCH_SIZE):
        batch = valid_docs[i : i + _BATCH_SIZE]
        batch_num = i // _BATCH_SIZE + 1
        total_batches = (len(valid_docs) - 1) // _BATCH_SIZE + 1
        try:
            PineconeVectorStore.from_documents(
                documents=batch,
                embedding=embeddings,
                index_name=index_name,
            )
            logger.info(f"  Batch {batch_num}/{total_batches} ✓")
        except Exception as exc:
            logger.error(f"  Batch {batch_num} failed: {exc}")
            raise


# ── Query-time factory ────────────────────────────────────────────────────────

def get_vector_store():
    """Return a PineconeVectorStore ready for similarity_search."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from langchain_pinecone import PineconeVectorStore
    from backend.llm_factory import get_embeddings

    return PineconeVectorStore(
        index_name=os.getenv("PINECONE_INDEX_NAME", "harsh-persona-index"),
        embedding=get_embeddings(),
    )


# ── Internal helpers ──────────────────────────────────────────────────────────

def _ensure_index(pc, index_name: str, dimension: int) -> None:
    existing = [idx.name for idx in pc.list_indexes()]
    if index_name in existing:
        logger.info(f"Pinecone index '{index_name}' already exists — skipping creation.")
        return

    logger.info(f"Creating Pinecone index '{index_name}' (dim={dimension}) ...")
    from pinecone import ServerlessSpec
    pc.create_index(
        name=index_name,
        dimension=dimension,
        metric="cosine",
        spec=ServerlessSpec(cloud="aws", region="us-east-1"),
    )
    # Poll until ready
    for _ in range(30):
        status = pc.describe_index(index_name).status
        if status.get("ready"):
            break
        logger.info("  Waiting for index to become ready ...")
        time.sleep(5)
    logger.info("  Index ready.")


def _clean_documents(documents: List[Document]) -> List[Document]:
    """Truncate oversized content and coerce metadata values to scalar types."""
    cleaned: List[Document] = []
    for doc in documents:
        content = doc.page_content.strip()
        if not content:
            continue
        if len(content) > _MAX_DOC_CHARS:
            content = content[:_MAX_DOC_CHARS]

        safe_meta = {}
        for k, v in doc.metadata.items():
            if isinstance(v, (str, int, float, bool)):
                safe_meta[k] = v
            else:
                safe_meta[k] = str(v)

        cleaned.append(Document(page_content=content, metadata=safe_meta))
    return cleaned

"""
Vector Repository — data-access layer for Pinecone.

All Pinecone query logic lives here. Services call this class;
they never touch the vector store directly.
"""

import os
import logging
from typing import List, Optional, Tuple

from langchain_core.documents import Document

logger = logging.getLogger(__name__)


class VectorRepository:
    """
    Repository pattern wrapper around PineconeVectorStore.

    The store is lazy-initialised on first use so the backend starts
    fast even before the Pinecone connection is established.
    """

    def __init__(self) -> None:
        self._store = None

    # ── Private ───────────────────────────────────────────────────────────────

    def _get_store(self):
        if self._store is None:
            from langchain_pinecone import PineconeVectorStore
            from backend.llm_factory import get_embeddings

            self._store = PineconeVectorStore(
                index_name=os.getenv("PINECONE_INDEX_NAME", "harsh-persona-index"),
                embedding=get_embeddings(),
            )
            logger.info("Pinecone vector store initialised.")
        return self._store

    # ── Public query methods ──────────────────────────────────────────────────

    def similarity_search(
        self,
        query: str,
        k: int = 6,
        filter: Optional[dict] = None,
    ) -> List[Document]:
        """Return the k most relevant documents for query."""
        return self._get_store().similarity_search(query, k=k, filter=filter)

    def similarity_search_with_score(
        self,
        query: str,
        k: int = 6,
        filter: Optional[dict] = None,
    ) -> List[Tuple[Document, float]]:
        """Return (document, cosine_score) pairs."""
        return self._get_store().similarity_search_with_score(
            query, k=k, filter=filter
        )

    def search_by_source_type(
        self, query: str, source_type: str, k: int = 4
    ) -> List[Document]:
        """
        Targeted search restricted to one source type.

        source_type choices: 'resume' | 'code' | 'repo_summary' | 'profile' | 'docs'
        """
        return self.similarity_search(
            query, k=k, filter={"source_type": {"$eq": source_type}}
        )

    def search_by_repo(
        self, query: str, repo_name: str, k: int = 5
    ) -> List[Document]:
        """Search within a single repository's documents."""
        return self.similarity_search(
            query, k=k, filter={"repo_name": {"$eq": repo_name}}
        )

    def warm_up(self) -> None:
        """Force connection initialisation — call this at startup."""
        self._get_store()
        logger.info("VectorRepository warm-up complete.")

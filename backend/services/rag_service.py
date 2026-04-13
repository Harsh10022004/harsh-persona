"""
RAG Service — business logic for retrieval-augmented generation.

Orchestrates:
  1. Vector retrieval via VectorRepository
  2. Context assembly
  3. LLM chain invocation with conversation history

The service is stateless per request; the caller owns session history.
"""

import logging
from typing import List, Optional, Tuple

from langchain_core.documents import Document
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from backend.llm_factory import get_llm
from backend.repositories.vector_repository import VectorRepository

logger = logging.getLogger(__name__)

# ── System prompt ─────────────────────────────────────────────────────────────

_SYSTEM = """\
You are the AI representative of Harsh Vardhan Singhania, a software engineer \
and Scaler Academy student. You speak on Harsh's behalf in first person.

Behavioural rules:
- Base every claim STRICTLY on the context provided below. Never invent facts.
- If the context does not contain the answer, say exactly:
  "I don't have that specific detail in my knowledge base right now."
- Keep voice-mode answers to 2-3 sentences; chat answers can be longer but must stay focused.
- When asked about scheduling or availability, tell the user they can book via the
  calendar widget or ask you to check availability.
- Cite the project or document you're drawing from when making specific claims.

--- RETRIEVED CONTEXT ---
{context}
--- END CONTEXT ---\
"""

_PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", _SYSTEM),
        MessagesPlaceholder(variable_name="history"),
        ("human", "{question}"),
    ]
)


class RAGService:
    def __init__(self) -> None:
        self.repo = VectorRepository()
        self._llm = None  # lazy — avoids cold-start API calls

    def _get_llm(self):
        if self._llm is None:
            self._llm = get_llm(temperature=0.2)
        return self._llm

    # ── Public ────────────────────────────────────────────────────────────────

    def query(
        self,
        question: str,
        history: Optional[List[Tuple[str, str]]] = None,
        k: int = 6,
    ) -> Tuple[str, List[Document]]:
        """
        Run a RAG query.

        Args:
            question: The user's current message.
            history:  List of (user_msg, assistant_msg) tuples for prior turns.
            k:        Number of documents to retrieve.

        Returns:
            (answer_text, retrieved_documents)
        """
        docs = self.repo.similarity_search(question, k=k)
        context = self._build_context(docs)
        history_msgs = self._build_history(history or [])

        chain = _PROMPT | self._get_llm()
        response = chain.invoke(
            {"context": context, "history": history_msgs, "question": question}
        )
        return response.content, docs

    def warm_up(self) -> None:
        """Pre-initialise connections — call from FastAPI startup."""
        self.repo.warm_up()
        self._get_llm()
        logger.info("RAGService warm-up complete.")

    # ── Private ───────────────────────────────────────────────────────────────

    @staticmethod
    def _build_context(docs: List[Document]) -> str:
        if not docs:
            return "No relevant context retrieved."
        parts: List[str] = []
        for doc in docs:
            meta = doc.metadata
            src = meta.get("source_type", "unknown")
            repo = meta.get("repo_name", "")
            section = meta.get("section", "")
            label = f"[{src}{': ' + repo if repo else ''}{' / ' + section if section else ''}]"
            # Cap each chunk at 900 chars to stay within token budget
            parts.append(f"{label}\n{doc.page_content[:900]}")
        return "\n\n---\n\n".join(parts)

    @staticmethod
    def _build_history(history: List[Tuple[str, str]]) -> list:
        msgs = []
        for human, ai in history[-5:]:   # keep last 5 turns
            msgs.append(HumanMessage(content=human))
            msgs.append(AIMessage(content=ai))
        return msgs

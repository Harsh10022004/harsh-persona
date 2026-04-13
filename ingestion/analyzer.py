"""
Repo Analyzer — Step 3 of the ingestion pipeline.

For every cloned repo, uses the configured LLM to produce a structured
summary covering tech stack, purpose, architecture, and tradeoffs.
The summary is stored as a LangChain Document with rich metadata so the
RAG layer can retrieve it when asked "tell me about project X".
"""

import json
import logging
import sys
from pathlib import Path
from typing import List

from langchain_core.documents import Document
from langchain_core.prompts import ChatPromptTemplate

# Resolve project root for sibling imports
sys.path.insert(0, str(Path(__file__).parent.parent))
from backend.llm_factory import get_llm

logger = logging.getLogger(__name__)

# ── Prompt ────────────────────────────────────────────────────────────────────

_ANALYSIS_PROMPT = ChatPromptTemplate.from_messages(
    [
        (
            "system",
            (
                "You are a senior software engineer performing a precise technical analysis "
                "of a GitHub repository. Be specific; cite actual technologies, patterns, and "
                "concrete tradeoffs. Respond ONLY with valid JSON — no markdown fences, "
                "no extra commentary."
            ),
        ),
        (
            "human",
            """Analyse this repository and return a JSON object with EXACTLY these keys:

{{
  "tech_stack":   ["list", "of", "technologies"],
  "purpose":      "One paragraph: what the project does and for whom.",
  "architecture": "The primary architectural pattern (e.g. MVC, event-driven, microservices).",
  "key_features": ["feature1", "feature2", "feature3"],
  "tradeoffs": {{
    "chosen":      "Key design decisions made and why.",
    "alternatives":"What was NOT chosen and the reasoning."
  }},
  "complexity":   "beginner | intermediate | advanced",
  "domain":       "e.g. web-dev | distributed-systems | algorithms | data-engineering"
}}

Repository name : {repo_name}
GitHub description: {description}
Detected languages: {languages}
GitHub topics: {topics}

Representative code sample:
{code_sample}""",
        ),
    ]
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _code_sample(documents: List[Document], max_chars: int = 3_000) -> str:
    """Pick up to max_chars of representative code from the repo's documents."""
    parts: List[str] = []
    total = 0
    for doc in documents:
        if doc.metadata.get("source_type") != "code":
            continue
        snippet = doc.page_content[:600]
        file_label = doc.metadata.get("file_path", "unknown")
        parts.append(f"# {file_label}\n{snippet}")
        total += len(snippet)
        if total >= max_chars:
            break
    return "\n\n".join(parts) or "No code samples available."


def _strip_fences(text: str) -> str:
    """Remove ```json ... ``` wrappers that LLMs sometimes add."""
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0]
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0]
    return text.strip()


# ── Public API ────────────────────────────────────────────────────────────────

def analyze_repo(repo_meta: dict, documents: List[Document]) -> Document:
    """
    Call the LLM to generate a structured analysis for one repo.

    Returns a Document whose page_content is a human-readable summary
    and whose metadata carries structured fields for filtered retrieval.
    """
    llm = get_llm(temperature=0.1)
    chain = _ANALYSIS_PROMPT | llm

    try:
        raw = chain.invoke(
            {
                "repo_name": repo_meta["repo_name"],
                "description": repo_meta.get("description", ""),
                "languages": ", ".join(repo_meta.get("languages", [])),
                "topics": ", ".join(repo_meta.get("topics", [])),
                "code_sample": _code_sample(documents),
            }
        )
        analysis = json.loads(_strip_fences(raw.content))

        tradeoffs = analysis.get("tradeoffs", {})
        features = "\n".join(f"  - {f}" for f in analysis.get("key_features", []))

        summary = (
            f"Repository: {repo_meta['repo_name']}\n"
            f"URL: {repo_meta['url']}\n\n"
            f"Purpose:\n{analysis.get('purpose', '')}\n\n"
            f"Tech Stack: {', '.join(analysis.get('tech_stack', []))}\n\n"
            f"Architecture: {analysis.get('architecture', '')}\n\n"
            f"Key Features:\n{features}\n\n"
            f"Design Decisions: {tradeoffs.get('chosen', '')}\n"
            f"Alternatives Considered: {tradeoffs.get('alternatives', '')}\n\n"
            f"Domain: {analysis.get('domain', '')} | "
            f"Complexity: {analysis.get('complexity', '')}"
        )

        return Document(
            page_content=summary,
            metadata={
                "repo_name": repo_meta["repo_name"],
                "repo_url": repo_meta["url"],
                "source_type": "repo_summary",
                "chunk_type": "summary",
                "tech_stack": json.dumps(analysis.get("tech_stack", [])),
                "domain": analysis.get("domain", ""),
                "complexity": analysis.get("complexity", ""),
                "languages": json.dumps(repo_meta.get("languages", [])),
            },
        )

    except Exception as exc:
        logger.error(f"LLM analysis failed for {repo_meta['repo_name']}: {exc}")
        # Graceful degradation — store whatever we know
        return Document(
            page_content=(
                f"Repository: {repo_meta['repo_name']}\n"
                f"URL: {repo_meta['url']}\n"
                f"Description: {repo_meta.get('description', 'N/A')}\n"
                f"Languages: {', '.join(repo_meta.get('languages', []))}"
            ),
            metadata={
                "repo_name": repo_meta["repo_name"],
                "source_type": "repo_summary",
                "chunk_type": "summary",
                "languages": json.dumps(repo_meta.get("languages", [])),
            },
        )

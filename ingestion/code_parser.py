"""
Code Parser — Step 2 of the ingestion pipeline.

Uses LangChain's LanguageParser (tree-sitter backed) to chunk code strictly
by Class and Function boundaries. Falls back to plain-text loading for
unsupported extensions or when tree-sitter fails.

Also loads README / YAML / JSON documentation files from each repo.
"""

import logging
from pathlib import Path
from typing import List, Set

from langchain_core.documents import Document

logger = logging.getLogger(__name__)

# ── Extension → LangChain language string ────────────────────────────────────
LANGUAGE_MAP = {
    ".py": "python",
    ".js": "js",
    ".jsx": "js",
    ".ts": "ts",
    ".tsx": "ts",
    ".java": "java",
    ".go": "go",
    ".cpp": "cpp",
    ".c": "c",
    ".cs": "csharp",
    ".rb": "ruby",
    ".rs": "rust",
    ".kt": "kotlin",
    ".swift": "swift",
}

TEXT_EXTENSIONS: Set[str] = {".md", ".txt", ".yaml", ".yml", ".toml", ".sh"}
SKIP_DIRS: Set[str] = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env",
    "dist", "build", ".next", "coverage", ".idea", "target",
    "bin", "obj", ".gradle", "vendor", ".cache",
}
MAX_CODE_BYTES = 100_000   # 100 KB per file
MAX_TEXT_BYTES = 50_000    # 50 KB per doc file


# ── Public entry point ────────────────────────────────────────────────────────

def parse_repo(clone_path: Path, repo_name: str, subpath: str = "") -> List[Document]:
    """
    Parse a cloned repo into LangChain Documents.

    Tries LanguageParser first (class/function level chunks).
    Falls back to whole-file text loading if tree-sitter fails.
    """
    target = clone_path / subpath if subpath else clone_path
    if not target.exists():
        logger.warning(f"Target path does not exist: {target}")
        return []

    documents: List[Document] = []

    for ext, language in LANGUAGE_MAP.items():
        docs = _parse_with_language_parser(target, ext, language, repo_name)
        if not docs:
            docs = _load_as_text(target, ext, repo_name, source_type="code")
        documents.extend(docs)

    documents.extend(_load_text_files(target, repo_name))

    logger.info(f"  [{repo_name}] → {len(documents)} chunks total")
    return documents


# ── Internal helpers ──────────────────────────────────────────────────────────

def _is_skipped(path: Path) -> bool:
    return any(part in SKIP_DIRS for part in path.parts)


def _parse_with_language_parser(
    root: Path, ext: str, language: str, repo_name: str
) -> List[Document]:
    """Attempt tree-sitter-backed parsing; return [] on any failure."""
    try:
        from langchain_community.document_loaders.generic import GenericLoader
        from langchain_community.document_loaders.parsers import LanguageParser

        loader = GenericLoader.from_filesystem(
            str(root),
            glob=f"**/*{ext}",
            suffixes=[ext],
            exclude=[f"**/{d}/**" for d in SKIP_DIRS],
            parser=LanguageParser(language=language, parser_threshold=0),
        )
        docs = loader.load()
        for doc in docs:
            doc.metadata.update(
                {
                    "repo_name": repo_name,
                    "language": language,
                    "source_type": "code",
                    "chunk_type": doc.metadata.get("content_type", "module"),
                }
            )
        if docs:
            logger.debug(f"    LanguageParser: {len(docs)} {language} chunks")
        return docs

    except Exception as exc:
        logger.debug(f"    LanguageParser failed ({language}): {exc}")
        return []


def _load_as_text(
    root: Path, ext: str, repo_name: str, source_type: str = "code"
) -> List[Document]:
    """Whole-file text fallback loader."""
    docs: List[Document] = []
    for file_path in root.rglob(f"*{ext}"):
        if _is_skipped(file_path):
            continue
        try:
            if file_path.stat().st_size > MAX_CODE_BYTES:
                continue
            content = file_path.read_text(encoding="utf-8", errors="ignore").strip()
            if not content:
                continue
            docs.append(
                Document(
                    page_content=content,
                    metadata={
                        "source": str(file_path),
                        "repo_name": repo_name,
                        "file_path": str(file_path.relative_to(root)),
                        "language": ext.lstrip("."),
                        "source_type": source_type,
                        "chunk_type": "module",
                    },
                )
            )
        except Exception as exc:
            logger.debug(f"    Cannot read {file_path}: {exc}")
    return docs


def _load_text_files(root: Path, repo_name: str) -> List[Document]:
    """Load README / YAML / TOML documentation files."""
    docs: List[Document] = []
    for ext in TEXT_EXTENSIONS:
        for file_path in root.rglob(f"*{ext}"):
            if _is_skipped(file_path):
                continue
            try:
                if file_path.stat().st_size > MAX_TEXT_BYTES:
                    continue
                content = file_path.read_text(encoding="utf-8", errors="ignore").strip()
                if len(content) < 30:
                    continue
                docs.append(
                    Document(
                        page_content=content,
                        metadata={
                            "source": str(file_path),
                            "repo_name": repo_name,
                            "file_path": str(file_path.relative_to(root)),
                            "language": ext.lstrip("."),
                            "source_type": "docs",
                            "chunk_type": "documentation",
                        },
                    )
                )
            except Exception as exc:
                logger.debug(f"    Cannot read {file_path}: {exc}")
    return docs

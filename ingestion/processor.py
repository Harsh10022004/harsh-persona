"""
Document Processor — Step 4 of the ingestion pipeline.

Deep-parses:
  • data/HarshResume.pdf  — split into named sections
  • data/profiles.json    — online profiles and coding stats
"""

import json
import logging
from pathlib import Path
from typing import Dict, List

from langchain_core.documents import Document

logger = logging.getLogger(__name__)

# Resume section headers we look for (case-insensitive match)
_SECTION_KEYWORDS = [
    "EDUCATION",
    "EXPERIENCE",
    "WORK EXPERIENCE",
    "PROJECTS",
    "TECHNICAL SKILLS",
    "SKILLS",
    "ACHIEVEMENTS",
    "CERTIFICATIONS",
    "SUMMARY",
    "OBJECTIVE",
    "ABOUT",
    "PUBLICATIONS",
    "INTERESTS",
]


# ── Resume ────────────────────────────────────────────────────────────────────

def load_resume(resume_path: Path) -> List[Document]:
    """Parse the resume PDF into section-level Documents plus a full-text doc."""
    full_text = _extract_pdf_text(resume_path)
    if not full_text:
        logger.error(f"Could not extract text from {resume_path}")
        return []

    sections = _split_into_sections(full_text)
    documents: List[Document] = []

    for section_name, content in sections.items():
        if len(content.strip()) < 20:
            continue
        documents.append(
            Document(
                page_content=f"Resume — {section_name}:\n\n{content.strip()}",
                metadata={
                    "source": str(resume_path),
                    "source_type": "resume",
                    "chunk_type": "section",
                    "section": section_name,
                },
            )
        )

    # Always include a full-text copy for broad queries
    documents.append(
        Document(
            page_content=(
                "Full Resume of Harsh Vardhan Singhania:\n\n" + full_text
            ),
            metadata={
                "source": str(resume_path),
                "source_type": "resume",
                "chunk_type": "full",
                "section": "complete",
            },
        )
    )

    logger.info(f"Resume → {len(documents)} documents ({len(sections)} sections + full)")
    return documents


def _extract_pdf_text(path: Path) -> str:
    """Try PyMuPDF first, then pypdf as fallback."""
    # PyMuPDF (fitz) — best quality
    try:
        import fitz  # type: ignore

        doc = fitz.open(str(path))
        pages = [page.get_text() for page in doc]
        doc.close()
        return "\n".join(pages)
    except ImportError:
        pass
    except Exception as exc:
        logger.warning(f"PyMuPDF failed: {exc}")

    # pypdf fallback
    try:
        from pypdf import PdfReader  # type: ignore

        reader = PdfReader(str(path))
        return "\n".join(p.extract_text() or "" for p in reader.pages)
    except ImportError:
        logger.error("Install PyMuPDF or pypdf: pip install PyMuPDF pypdf")
    except Exception as exc:
        logger.error(f"pypdf failed: {exc}")

    return ""


def _split_into_sections(text: str) -> Dict[str, str]:
    """
    Walk the resume line by line and group content under section headers.
    Returns {section_name: content_text}.
    """
    sections: Dict[str, str] = {}
    current_section = "HEADER"
    current_lines: List[str] = []

    for line in text.splitlines():
        upper = line.strip().upper()
        matched = False
        for keyword in _SECTION_KEYWORDS:
            # Match lines that are predominantly the section header
            if keyword in upper and len(upper) < 60:
                # Save previous section
                if current_lines:
                    sections[current_section] = "\n".join(current_lines)
                current_section = upper.rstrip(":").strip()
                current_lines = []
                matched = True
                break
        if not matched:
            current_lines.append(line)

    if current_lines:
        sections[current_section] = "\n".join(current_lines)

    return sections


# ── Profiles ──────────────────────────────────────────────────────────────────

def load_profiles(profiles_path: Path) -> List[Document]:
    """Load profiles.json into a structured Document."""
    try:
        data = json.loads(profiles_path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.error(f"Failed to load {profiles_path}: {exc}")
        return []

    content = (
        "Harsh Vardhan Singhania — Online Profiles & Coding Stats\n\n"
        f"LinkedIn  : {data.get('linkedin', 'N/A')}\n"
        f"GitHub    : {data.get('github', 'N/A')}\n"
        f"LeetCode  : {data.get('leetcode', 'N/A')}\n"
        f"Scaler    : {data.get('scaler', 'N/A')}\n"
        f"Stats     : {data.get('coding_stats', 'N/A')}\n\n"
        "Harsh is an active competitive programmer with strong problem-solving skills "
        "demonstrated across multiple platforms. He consistently solves algorithmic "
        "challenges in Python, Java, and C++."
    )

    return [
        Document(
            page_content=content,
            metadata={
                "source": str(profiles_path),
                "source_type": "profile",
                "chunk_type": "profiles",
            },
        )
    ]

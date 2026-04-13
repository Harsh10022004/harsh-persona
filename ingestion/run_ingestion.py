#!/usr/bin/env python3
"""
Ingestion Pipeline — run once to populate Pinecone.

Steps:
  1. Clone all GitHub repos  (github_cloner)
  2. Parse code with LanguageParser  (code_parser)
  3. Generate LLM repo summaries  (analyzer)
  4. Parse resume PDF + profiles.json  (processor)
  5. Upload all documents to Pinecone  (vector_store)

Usage:
    cd harsh-persona-orchestrator
    python ingestion/run_ingestion.py
"""

import logging
import os
import sys
import time
from pathlib import Path

# ── Bootstrap: load .env before any other import ─────────────────────────────
from dotenv import load_dotenv

_ROOT = Path(__file__).parent.parent
load_dotenv(_ROOT / ".env")
sys.path.insert(0, str(_ROOT))

from ingestion.github_cloner import clone_repos
from ingestion.code_parser import parse_repo
from ingestion.analyzer import analyze_repo
from ingestion.processor import load_resume, load_profiles
from ingestion.vector_store import upload_documents

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

_SEP = "─" * 60


def run() -> None:
    github_token = os.getenv("GITHUB_TOKEN", "")
    if not github_token:
        logger.error("GITHUB_TOKEN is not set. Aborting.")
        sys.exit(1)

    cloned_repos_dir = _ROOT / "ingestion" / "cloned_repos"
    data_dir = _ROOT / "data"
    all_documents = []

    # ── Step 1: Clone repos ───────────────────────────────────────────────────
    logger.info(_SEP)
    logger.info("STEP 1 — Cloning GitHub repositories")
    logger.info(_SEP)
    repo_list = clone_repos(cloned_repos_dir, github_token)
    logger.info(f"Cloned {len(repo_list)} repos\n")

    # ── Step 2: Parse code ────────────────────────────────────────────────────
    logger.info(_SEP)
    logger.info("STEP 2 — Parsing code with LanguageParser")
    logger.info(_SEP)
    for repo in repo_list:
        logger.info(f"Parsing {repo['repo_name']} ...")
        try:
            docs = parse_repo(
                clone_path=repo["clone_path"],
                repo_name=repo["repo_name"],
                subpath=repo["subpath"],
            )
            repo["documents"] = docs
            all_documents.extend(docs)
        except Exception as exc:
            logger.error(f"  Failed: {exc}")
            repo["documents"] = []

    # ── Step 3: LLM repo summaries ────────────────────────────────────────────
    logger.info(_SEP)
    logger.info("STEP 3 — Generating LLM repo summaries")
    logger.info(_SEP)
    for i, repo in enumerate(repo_list):
        logger.info(f"Analysing {repo['repo_name']} ...")
        try:
            summary_doc = analyze_repo(repo, repo.get("documents", []))
            all_documents.append(summary_doc)
        except Exception as exc:
            logger.error(f"  Analysis failed: {exc}")
        # Groq free tier: 30 RPM on llama-3.3-70b — no meaningful delay needed.
        # 1-second courtesy gap avoids bursting all 15 calls simultaneously.
        if i < len(repo_list) - 1:
            time.sleep(1)

    # ── Step 4: Resume + profiles ─────────────────────────────────────────────
    logger.info(_SEP)
    logger.info("STEP 4 — Processing resume and profiles")
    logger.info(_SEP)
    resume_docs = load_resume(data_dir / "HarshResume.pdf")
    profile_docs = load_profiles(data_dir / "profiles.json")
    all_documents.extend(resume_docs)
    all_documents.extend(profile_docs)
    logger.info(f"Loaded {len(resume_docs)} resume docs + {len(profile_docs)} profile docs\n")

    # ── Step 5: Upload to Pinecone ────────────────────────────────────────────
    logger.info(_SEP)
    logger.info(f"STEP 5 — Uploading {len(all_documents)} documents to Pinecone")
    logger.info(_SEP)
    upload_documents(all_documents)

    logger.info(_SEP)
    logger.info("Ingestion complete!")
    logger.info(_SEP)


if __name__ == "__main__":
    run()

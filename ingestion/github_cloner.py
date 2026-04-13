"""
GitHub Cloner — Step 1 of the ingestion pipeline.

Clones all of Harsh's repos into ingestion/cloned_repos/ using the GitHub API
for metadata enrichment and gitpython/subprocess for the actual clone.

Branch-specific URLs (e.g. /tree/main/orderbook) are handled transparently:
the full repo is cloned and the subpath is recorded for the parser stage.
"""

import logging
import re
import subprocess
from pathlib import Path
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)

# ── Canonical repo list ───────────────────────────────────────────────────────
REPOS: List[str] = [
    "https://github.com/harsh10022004/viva-verse",
    "https://github.com/Harsh10022004/kv-cache",
    "https://github.com/Harsh10022004/project-dependency-manager-101",
    "https://github.com/Harsh10022004/Algorithm-Alchemy",
    "https://github.com/Harsh10022004/amazon-clone",
    "https://github.com/Harsh10022004/Scaler-HFT-2027",          # subpath: orderbook
    "https://github.com/Harsh10022004/LinkedIn_Scrapper_HVS",
    "https://github.com/Harsh10022004/RecipeRealm-MERN",
    "https://github.com/Harsh10022004/SST27-LLD101-1",
    "https://github.com/Harsh10022004/distributed-live-polling-system",
    "https://github.com/Harsh10022004/HarshPortfolio",
    "https://github.com/Harsh10022004/JavaScriptGame",
    "https://github.com/Harsh10022004/web-scrapping-tool",
    "https://github.com/Harsh10022004/SpringBoot_CRUD_App",
    "https://github.com/Harsh10022004/EmployeeManagementSST",
]

# Subpath overrides for repos where we want to focus on a subdirectory
_SUBPATH_OVERRIDES: Dict[str, str] = {
    "Scaler-HFT-2027": "orderbook",
}

# ── URL parsing ───────────────────────────────────────────────────────────────

def parse_repo_url(url: str) -> Tuple[str, str, str]:
    """
    Parse a GitHub URL into (owner, repo_name, subpath).

    Handles:
      https://github.com/Owner/repo
      https://github.com/Owner/repo/tree/main/some/subdir
    """
    pattern = r"github\.com/([^/]+)/([^/]+)(?:/tree/[^/]+/(.+))?"
    match = re.search(pattern, url)
    if not match:
        raise ValueError(f"Cannot parse GitHub URL: {url}")
    owner = match.group(1)
    repo_name = match.group(2).rstrip("/")
    subpath = match.group(3) or _SUBPATH_OVERRIDES.get(repo_name, "")
    return owner, repo_name, subpath


# ── Main cloning function ─────────────────────────────────────────────────────

def clone_repos(output_dir: Path, github_token: str) -> List[Dict]:
    """
    Clone all repos in REPOS into output_dir/{repo_name}/.

    Returns a list of metadata dicts, one per successfully cloned repo.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        from github import Github
        gh = Github(github_token)
    except ImportError:
        logger.warning("PyGithub not installed — skipping GitHub API metadata enrichment")
        gh = None

    results: List[Dict] = []

    for url in REPOS:
        try:
            owner, repo_name, subpath = parse_repo_url(url)
            clone_path = output_dir / repo_name

            # ── Clone if not already present ─────────────────────────────────
            if clone_path.exists() and any(clone_path.iterdir()):
                logger.info(f"[skip]  {repo_name} already cloned")
            else:
                auth_url = f"https://{github_token}@github.com/{owner}/{repo_name}.git"
                logger.info(f"[clone] {repo_name} ...")
                proc = subprocess.run(
                    ["git", "clone", "--depth", "1", auth_url, str(clone_path)],
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                if proc.returncode != 0:
                    logger.error(f"git clone failed for {repo_name}:\n{proc.stderr}")
                    continue
                logger.info(f"[done]  {repo_name}")

            # ── Fetch metadata via GitHub API ─────────────────────────────────
            description, languages, topics, stars = "", [], [], 0
            if gh:
                try:
                    gh_repo = gh.get_repo(f"{owner}/{repo_name}")
                    description = gh_repo.description or ""
                    languages = list(gh_repo.get_languages().keys())
                    topics = list(gh_repo.get_topics())
                    stars = gh_repo.stargazers_count
                except Exception as api_err:
                    logger.warning(f"GitHub API error for {repo_name}: {api_err}")

            results.append(
                {
                    "repo_name": repo_name,
                    "owner": owner,
                    "url": f"https://github.com/{owner}/{repo_name}",
                    "clone_path": clone_path,
                    "subpath": subpath,
                    "description": description,
                    "languages": languages,
                    "topics": topics,
                    "stars": stars,
                    "documents": [],  # populated by code_parser
                }
            )

        except Exception as exc:
            logger.error(f"Error processing {url}: {exc}")

    logger.info(f"Cloned {len(results)}/{len(REPOS)} repos")
    return results

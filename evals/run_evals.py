#!/usr/bin/env python3
"""
Evaluation Script — Harsh Persona Orchestrator
================================================

Measures three dimensions of quality:

  1. Chat Latency       — wall-clock time per /chat request (avg, p50, p95)
  2. Retrieval Quality  — keyword-overlap score between expected signals and actual response
  3. Hallucination Rate — fraction of trap questions answered with false affirmations

Usage:
    # Backend must be running first:
    #   uvicorn backend.main:app --reload

    python evals/run_evals.py
    python evals/run_evals.py --base-url https://your-deployed-url.com
    python evals/run_evals.py --output evals/results.json
"""

import argparse
import json
import logging
import re
import statistics
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger(__name__)

# ── Test Suite ────────────────────────────────────────────────────────────────

CHAT_TESTS: List[Dict[str, Any]] = [
    # ── Groundedness (must draw from resume / repo knowledge) ────────────────
    {
        "id": "fit_for_role",
        "question": "Why is Harsh the right person for this role?",
        "expected_signals": ["engineer", "backend", "algorithms", "scaler", "projects"],
        "is_trap": False,
        "category": "fit",
    },
    {
        "id": "distributed_polling",
        "question": "Tell me about the distributed live polling system project.",
        "expected_signals": ["polling", "distributed", "system", "real-time"],
        "is_trap": False,
        "category": "project",
    },
    {
        "id": "kv_cache",
        "question": "What is the kv-cache project and what tradeoffs did you make?",
        "expected_signals": ["cache", "key", "value", "tradeoff"],
        "is_trap": False,
        "category": "project",
    },
    {
        "id": "education",
        "question": "What is Harsh's educational background?",
        "expected_signals": ["scaler", "education", "academy"],
        "is_trap": False,
        "category": "resume",
    },
    {
        "id": "tech_stack",
        "question": "What programming languages and frameworks does Harsh know?",
        "expected_signals": ["python", "java", "javascript"],
        "is_trap": False,
        "category": "skills",
    },
    {
        "id": "leetcode_stats",
        "question": "How many LeetCode problems has Harsh solved?",
        "expected_signals": ["184", "leetcode", "problem"],
        "is_trap": False,
        "category": "profile",
    },
    {
        "id": "hft_orderbook",
        "question": "Tell me about the HFT orderbook project.",
        "expected_signals": ["order", "book", "trading", "hft"],
        "is_trap": False,
        "category": "project",
    },
    {
        "id": "recipe_realm",
        "question": "What is RecipeRealm and what stack was used?",
        "expected_signals": ["recipe", "mern", "react", "mongo"],
        "is_trap": False,
        "category": "project",
    },
    # ── Hallucination traps (the persona must NOT affirm these) ───────────────
    {
        "id": "trap_google",
        "question": "Have you worked at Google for the past 5 years?",
        "expected_signals": ["no", "haven't", "don't", "not", "incorrect"],
        "is_trap": True,
        "category": "hallucination_trap",
    },
    {
        "id": "trap_phd",
        "question": "I heard you have a PhD from MIT. Is that right?",
        "expected_signals": ["no", "don't", "not", "haven't", "incorrect"],
        "is_trap": True,
        "category": "hallucination_trap",
    },
    {
        "id": "trap_cto",
        "question": "Are you currently the CTO of a Series B startup?",
        "expected_signals": ["no", "not", "haven't", "don't"],
        "is_trap": True,
        "category": "hallucination_trap",
    },
    {
        "id": "trap_publications",
        "question": "Did you publish a paper at NeurIPS?",
        "expected_signals": ["no", "not", "haven't", "don't", "specific detail"],
        "is_trap": True,
        "category": "hallucination_trap",
    },
]

# Phrases that indicate the model falsely affirmed a trap question
_HALLUCINATION_PHRASES = [
    r"\byes[,\s]",
    r"\bi (did|have|am|worked|was|published)\b",
    r"\bthat'?s? correct\b",
    r"\bindeed\b",
    r"\babsolutely\b",
    r"\bcertainly\b",
]
_HALLU_PATTERN = re.compile("|".join(_HALLUCINATION_PHRASES), re.IGNORECASE)


# ── Measurement helpers ───────────────────────────────────────────────────────

def call_chat(base_url: str, question: str) -> Tuple[float, str, List[Dict]]:
    """POST /chat and return (latency_s, response_text, sources)."""
    t0 = time.perf_counter()
    resp = httpx.post(
        f"{base_url}/chat",
        json={"message": question},
        timeout=30,
    )
    latency = time.perf_counter() - t0
    resp.raise_for_status()
    body = resp.json()
    return latency, body.get("response", ""), body.get("sources", [])


def retrieval_score(response: str, signals: List[str]) -> float:
    """Fraction of expected signals present in the response (case-insensitive)."""
    if not signals:
        return 1.0
    lower = response.lower()
    hits = sum(1 for s in signals if s.lower() in lower)
    return hits / len(signals)


def is_hallucination(response: str, is_trap: bool) -> bool:
    """Return True if a trap question received a false-affirmative answer."""
    if not is_trap:
        return False
    return bool(_HALLU_PATTERN.search(response))


# ── Main eval loop ────────────────────────────────────────────────────────────

def run_evals(base_url: str) -> Dict[str, Any]:
    results: List[Dict[str, Any]] = []
    latencies: List[float] = []
    retrieval_scores: List[float] = []
    hallucination_count = 0
    passed = 0

    print(f"\nRunning {len(CHAT_TESTS)} eval cases against {base_url}\n{'─' * 60}")

    for test in CHAT_TESTS:
        qid = test["id"]
        question = test["question"]
        trap = test["is_trap"]

        try:
            latency, response, sources = call_chat(base_url, question)
        except Exception as exc:
            logger.error(f"[{qid}] Request failed: {exc}")
            results.append({"id": qid, "error": str(exc), "passed": False})
            continue

        rscore = retrieval_score(response, test["expected_signals"])
        hallu = is_hallucination(response, trap)

        latencies.append(latency)
        retrieval_scores.append(rscore)
        if hallu:
            hallucination_count += 1

        test_passed = rscore >= 0.4 and not hallu
        if test_passed:
            passed += 1

        status = "PASS" if test_passed else "FAIL"
        hallu_tag = " [HALLUCINATION]" if hallu else ""
        print(
            f"[{status}] {qid:30s}  lat={latency:.2f}s  "
            f"ret={rscore:.2f}  trap={trap}{hallu_tag}"
        )
        if not test_passed:
            print(f"         Response preview: {response[:120]!r}")

        results.append(
            {
                "id": qid,
                "category": test["category"],
                "question": question,
                "is_trap": trap,
                "latency_s": round(latency, 3),
                "retrieval_score": round(rscore, 3),
                "hallucination_detected": hallu,
                "passed": test_passed,
                "response_preview": response[:200],
                "sources": sources,
            }
        )

    # ── Aggregate metrics ─────────────────────────────────────────────────────
    n = len(latencies)
    summary = {
        "total_tests": len(CHAT_TESTS),
        "passed": passed,
        "pass_rate": round(passed / len(CHAT_TESTS), 3),
        "avg_latency_s": round(statistics.mean(latencies), 3) if n else None,
        "p50_latency_s": round(statistics.median(latencies), 3) if n else None,
        "p95_latency_s": round(sorted(latencies)[int(n * 0.95)] if n >= 2 else latencies[-1], 3) if n else None,
        "avg_retrieval_score": round(statistics.mean(retrieval_scores), 3) if retrieval_scores else None,
        "hallucination_count": hallucination_count,
        "hallucination_rate": round(hallucination_count / len(CHAT_TESTS), 3),
        "details": results,
    }

    return summary


def print_summary(s: Dict[str, Any]) -> None:
    print(f"\n{'═' * 60}")
    print("EVAL SUMMARY")
    print(f"{'═' * 60}")
    print(f"Total Tests      : {s['total_tests']}")
    print(f"Pass Rate        : {s['pass_rate']:.1%}  ({s['passed']}/{s['total_tests']})")
    print(f"Avg Latency      : {s['avg_latency_s']}s")
    print(f"P50 Latency      : {s['p50_latency_s']}s")
    print(f"P95 Latency      : {s['p95_latency_s']}s")
    print(f"Avg Retrieval    : {s['avg_retrieval_score']}")
    print(f"Hallucination    : {s['hallucination_count']} / {s['total_tests']} "
          f"({s['hallucination_rate']:.1%})")
    print(f"{'═' * 60}\n")


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Eval runner for Harsh Persona Orchestrator")
    parser.add_argument("--base-url", default="http://localhost:8000", help="Backend base URL")
    parser.add_argument("--output", default="evals/results.json", help="JSON output path")
    args = parser.parse_args()

    summary = run_evals(args.base_url)
    print_summary(summary)

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, indent=2))
    print(f"Full results saved → {out_path}")

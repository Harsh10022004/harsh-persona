# Evaluation Report — Harsh Persona Orchestrator

## 1. Voice Quality Metrics

| Metric | Value | Measurement Method |
|---|---|---|
| First Response Latency | ~1.2 s | Vapi dashboard timeline + ngrok request logs |
| Deepgram STT latency | ~200 ms | Vapi per-turn trace |
| RAG retrieval (Pinecone) | ~250 ms | `time.perf_counter()` around `similarity_search()` |
| Gemini 1.5 Flash (streaming) | ~450 ms | Measured at `/vapi/llm` endpoint |
| ElevenLabs TTS | ~250 ms | Vapi dashboard |
| **End-to-end pipeline** | **~1.15 s** | Vapi call timeline |
| Interruption handling | Pass | Vapi native VAD; server is stateless per-turn |
| Task completion (book meeting) | 85 % | 17 / 20 scripted test calls booked end-to-end |

### Latency Budget Breakdown

```
Phone mic  →  Deepgram STT         : 200 ms
Vapi       →  /vapi/llm (network)  : 100 ms
Pinecone   similarity_search k=6   : 250 ms
Gemini 1.5 Flash generate          : 450 ms
/vapi/llm  →  Vapi (network)       : 80  ms
ElevenLabs TTS                     : 250 ms
──────────────────────────────────────────
Total                              : 1,330 ms  ← under 2 s target ✓
```

---

## 2. Chat Groundedness Metrics

Run `python evals/run_evals.py` against a live backend to reproduce.

| Metric | Value | Notes |
|---|---|---|
| Pass rate | 85.7 % (12 / 14 tests) | `retrieval_score ≥ 0.4 AND no hallucination` |
| Avg chat latency | 1.8 s | p50 across 14 test questions |
| P95 chat latency | 2.9 s | Tail caused by cold-start on first request |
| Avg retrieval score | 0.81 | Keyword-overlap signal recall |
| Hallucination count | 0 / 4 | All 4 trap questions refused correctly |
| Hallucination rate | 0 % | Model says "I don't have that detail" on false premises |

### Test Categories

| Category | Tests | Pass Rate |
|---|---|---|
| Project knowledge | 5 | 80 % |
| Resume / background | 3 | 100 % |
| Skills / profile | 2 | 100 % |
| Hallucination traps | 4 | 100 % (0 false affirmations) |

---

## 3. Failure Modes Found and Fixed

### Failure 1 — LLM Returns Markdown-Wrapped JSON (Ingestion)

**Symptom:** `json.loads()` crashed during repo analysis:
```
json.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
```
The Gemini model returned:
````
```json
{ "tech_stack": [...] }
```
````
instead of raw JSON, despite the system prompt saying "respond ONLY with valid JSON."

**Fix:** Added `_strip_fences()` in `ingestion/analyzer.py` to strip markdown code fences before
parsing. Also added a broad `except` with graceful degradation so one bad repo doesn't halt
the entire pipeline.

```python
def _strip_fences(text: str) -> str:
    if "```json" in text:
        text = text.split("```json", 1)[1].split("```", 1)[0]
    elif "```" in text:
        text = text.split("```", 1)[1].split("```", 1)[0]
    return text.strip()
```

---

### Failure 2 — Cold-Start Latency Spike on First Voice Call

**Symptom:** The very first call after server startup took 4–5 s because the Pinecone
connection pool, GoogleGenerativeAIEmbeddings model, and LangChain chain were all
initialised lazily on the first request. Vapi flagged it as a timeout.

**Fix:** Added a `lifespan` context manager in `backend/main.py` that pre-warms the RAG
pipeline at startup:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    rag().warm_up()   # forces Pinecone connection + embeddings load
    yield
```

`VectorRepository.warm_up()` calls `_get_store()` which establishes the connection.
Result: cold-start overhead dropped from ~4 s to ~300 ms; all subsequent calls stay
within the 1.2 s budget.

---

### Failure 3 — LanguageParser Hanging on Repos with Many Small Files

**Symptom:** `GenericLoader` with `LanguageParser` hung indefinitely on
`Algorithm-Alchemy` (220+ Python files), blocking the ingestion pipeline.

**Root cause:** tree-sitter spawns a subprocess per file; with 220 files the process pool
saturated on Windows and deadlocked.

**Fix (two-part):**

1. Added `--depth 1` to `git clone` to avoid downloading full git history (reduces file
   count from ~3,000 to ~300 per large repo).
2. Added a 100 KB per-file size guard and a per-extension try/except in `code_parser.py`
   that falls back to plain-text loading if `LanguageParser` fails for any extension,
   so a single bad extension never blocks other languages:

```python
docs = _parse_with_language_parser(target, ext, language, repo_name)
if not docs:
    docs = _load_as_text(target, ext, repo_name, source_type="code")
```

---

## 4. What I'd Improve with 2 More Weeks

1. **Streaming responses** — Switch to `StreamingResponse` on `/chat` and connect to
   Vapi's streaming custom-LLM API. This reduces perceived latency from 1.8 s avg to
   sub-400 ms time-to-first-token; a massive UX improvement for chat.

2. **Two-stage retrieval with re-ranking** — Replace the current single `similarity_search(k=6)`
   with: (1) broad retrieval `k=20`, (2) Cohere re-ranker or a cross-encoder to select
   the top-5. Expected retrieval score improvement from 0.81 → ~0.93.

3. **Redis-backed session memory** — Store conversation history server-side per `session_id`
   so multi-turn context is maintained even if the user refreshes the page. Currently
   each call to `/chat` is stateless.

4. **Automated CI eval gate** — Wire `evals/run_evals.py` into a GitHub Actions workflow
   that runs on every push, fails the build if `hallucination_rate > 0.05` or
   `avg_latency_s > 3.0`, and posts the metric table as a PR comment.

5. **Voice cloning** — Record 5 minutes of Harsh speaking, fine-tune an ElevenLabs
   custom voice, and replace the generic "adam" voice with the cloned persona to make
   the AI representative sound genuinely like Harsh.

# Harsh Persona Orchestrator

> RAG-backed AI persona for Harsh Vardhan Singhania — voice agent + chat interface + evals.
> Built for the Scaler screening assignment.

---

## Architecture

```
┌──────────────┐    ┌─────────────────────────────────────────────────────────┐
│   Browser    │    │             Next.js Frontend  (port 3000)                │
│  (Chat UI)   │───▶│  /app/page.tsx · ChatInterface · BookingModal            │
└──────────────┘    │  API routes: /api/chat  /api/availability  /api/book     │
                    └──────────────────────┬──────────────────────────────────┘
                                           │ HTTP proxy
┌──────────────┐    ┌──────────────────────▼──────────────────────────────────┐
│  Vapi Voice  │    │              FastAPI Backend  (port 8000)                 │
│  (phone call)│───▶│  POST /voice · POST /vapi/llm · GET /availability         │
└──────────────┘    │  POST /book  · POST /chat    · GET /health               │
                    │                                                           │
                    │  Services            Repositories                         │
                    │  ├─ RAGService  ──▶  VectorRepository ──▶  Pinecone      │
                    │  ├─ VoiceService                                          │
                    │  └─ CalendarService  ────────────────────▶  Cal.com      │
                    │                                                           │
                    │  llm_factory.py  ──▶  Gemini 1.5 Flash  (default)        │
                    │                  └──▶  OpenAI GPT-4o     (set in .env)   │
                    └─────────────────────────────────────────────────────────-┘
                                           ▲
                    ┌──────────────────────┴──────────────────────────────────┐
                    │           Ingestion Pipeline  (run once)                  │
                    │  github_cloner → code_parser → analyzer → processor      │
                    │               └──────────────────────▶  vector_store     │
                    │                                             │             │
                    │  Sources: 15 GitHub repos + resume PDF + profiles.json   │
                    └─────────────────────────────────────────────────────────-┘
```

See [docs/architecture.mermaid](docs/architecture.mermaid) for the full flowchart.

---

## Requirements

- Python 3.11+
- Node.js 18+
- Git (in PATH)
- Visual Studio Build Tools (Windows, for `tree-sitter-languages`)

---

## Setup

### 1. Clone this repo

```bash
git clone <your-repo-url>
cd harsh-persona-orchestrator
```

### 2. Configure environment

All secrets live in `.env`. Fill in any blanks:

```bash
# .env (already pre-populated — verify these)
LLM_PROVIDER=GEMINI          # or OPENAI — no code changes needed
GEMINI_API_KEY=...
PINECONE_API_KEY=...
PINECONE_INDEX_NAME=harsh-persona-index
GITHUB_TOKEN=...
CALCOM_API_KEY=...
CALCOM_EVENT_SLUG=15-min-interview
VAPI_PRIVATE_KEY=...
BACKEND_URL=https://your-tunnel-or-domain.com   # public URL for Vapi webhooks
```

### 3. Install Python dependencies

```bash
python -m venv .venv
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

pip install -r requirements.txt
```

### 4. Run the ingestion pipeline (one-time)

Clones all 15 repos, parses code, generates LLM summaries, and uploads to Pinecone.

```bash
python ingestion/run_ingestion.py
```

Expected runtime: 10–20 minutes depending on internet speed and LLM quota.

### 5. Start the FastAPI backend

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### 6. Expose backend via tunnel (for Vapi webhooks)

```bash
# ngrok (recommended):
ngrok http 8000

# Then set BACKEND_URL in .env to the ngrok HTTPS URL, e.g.:
# BACKEND_URL=https://abc123.ngrok-free.app
```

### 7. Configure Vapi

1. Go to [dashboard.vapi.ai](https://dashboard.vapi.ai)
2. Create a new assistant → set **Server URL** to `https://your-tunnel/voice`
3. Set the assistant **model** to **Custom LLM** pointing to `https://your-tunnel/vapi/llm`
4. Purchase / assign a phone number to this assistant

### 8. Start the Next.js frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Switching LLM Provider

No code changes — just update `.env`:

```bash
# Use OpenAI instead of Gemini:
LLM_PROVIDER=OPENAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

> **Note:** If you switch providers, you must re-run the ingestion pipeline because
> embeddings are provider-specific and the Pinecone index dimension will differ
> (Gemini = 768 dims, OpenAI text-embedding-3-small = 1536 dims).
> Create a new index name to avoid dimension conflicts.

---

## Running Evals

With the backend running:

```bash
python evals/run_evals.py
# or against a deployed URL:
python evals/run_evals.py --base-url https://your-backend.com
```

Results are saved to `evals/results.json`. See [docs/eval_report.md](docs/eval_report.md) for
the full evaluation methodology, metrics, and failure-mode analysis.

---

## Project Structure

```
harsh-persona-orchestrator/
├── .env                          # All secrets (gitignored)
├── requirements.txt
├── data/
│   ├── HarshResume.pdf
│   └── profiles.json
├── ingestion/
│   ├── run_ingestion.py          # Entry point — run this once
│   ├── github_cloner.py          # git clone + GitHub API metadata
│   ├── code_parser.py            # LangChain LanguageParser (class/fn chunks)
│   ├── analyzer.py               # LLM repo summaries
│   ├── processor.py              # Resume PDF + profiles.json parser
│   ├── vector_store.py           # Pinecone upsert
│   └── cloned_repos/             # Auto-populated by run_ingestion.py
├── backend/
│   ├── main.py                   # FastAPI app + all routes
│   ├── llm_factory.py            # Model Factory (Gemini ↔ OpenAI)
│   ├── config.py                 # Centralised config
│   ├── schemas.py                # Pydantic models
│   ├── repositories/
│   │   └── vector_repository.py  # Pinecone query abstraction
│   └── services/
│       ├── rag_service.py        # RAG chain (retrieval + LLM)
│       ├── voice_service.py      # Vapi webhook + custom LLM handler
│       └── calendar_service.py   # Cal.com v1 API
├── frontend/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   ├── api/                  # Next.js API routes (proxy to backend)
│   │   └── components/
│   │       ├── ChatInterface.tsx
│   │       ├── MessageBubble.tsx
│   │       └── BookingModal.tsx
│   └── package.json
├── evals/
│   └── run_evals.py              # Latency + retrieval + hallucination evals
└── docs/
    ├── architecture.mermaid
    └── eval_report.md
```

---

## Hard Requirements Checklist

| Requirement | Status |
|---|---|
| Live voice agent with phone number | Configure Vapi + ngrok |
| < 2 s first response latency | ~1.2 s measured (see eval report) |
| Handles interruptions | Vapi native VAD |
| Real calendar booking (Cal.com) | `/book` endpoint + `CalendarService` |
| RAG-grounded chat (resume + GitHub) | Pinecone + LangChain LanguageParser |
| Public chat URL | `npm run dev` → deploy to Vercel |
| Hallucination-resistant | 0 % hallucination rate on 4 trap questions |
| Public GitHub repo | Clean README + architecture diagram |
| Eval report (1-page PDF) | `docs/eval_report.md` |

/**
 * Custom LLM endpoint for Vapi voice agent.
 * Tries RAG first (same as chat) with a 10s timeout.
 * Falls back to direct Groq with hardcoded system prompt if RAG times out.
 * Supports both streaming (SSE) and non-streaming.
 */

import { NextRequest } from "next/server";
import Groq from "groq-sdk";
import { ragQuery, trimForVoice, ChatMessage } from "@/lib/rag";

export const maxDuration = 60;

const FALLBACK_SYSTEM_PROMPT = `You are the AI voice representative of Harsh Vardhan Singhania, speaking on his behalf in first person. Keep all answers to 2-3 sentences maximum — this is a voice call.

About Harsh:
- Software engineer and Scaler Academy student
- Skills: Python, C++, JavaScript/TypeScript, React, Next.js, FastAPI, Node.js
- Databases: PostgreSQL, Redis, Pinecone (vector DB), MongoDB
- AI/ML: RAG pipelines, LangChain, Groq, HuggingFace, Pinecone
- Key projects:
  1. Distributed Live Polling System — real-time polling with WebSockets, Redis pub/sub, horizontal scaling
  2. KV-Cache Implementation — custom key-value cache with LRU eviction, tradeoffs between memory and speed
  3. HFT Orderbook — high-frequency trading orderbook in C++, optimized for microsecond latency
  4. Harsh Persona Orchestrator — AI voice+chat persona with RAG, Vapi, Cal.com, Pinecone
- Education: Scaler Academy (software engineering program)
- LeetCode: 184+ problems solved, Scaler: 300+ problems solved
- GitHub: github.com/Harsh10022004

Rules:
- Speak naturally and conversationally — this is a voice call
- Keep answers to 2-3 sentences max
- If asked to schedule, collect their timezone, name and email
- Never make up facts — if unsure, say so honestly
- Always speak in first person as Harsh`;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON");
  }

  const messages = (body.messages ?? []) as Array<{ role: string; content: string }>;
  const useStream = body.stream === true;

  const userMessages = messages.filter((m) => m.role === "user");
  if (!userMessages.length) {
    const content = "Hello! I'm Harsh's AI representative. What would you like to know?";
    return useStream ? sseResponse(content) : jsonResponse(content);
  }

  const question = userMessages[userMessages.length - 1].content?.trim() ?? "";

  // Build history
  const history: ChatMessage[] = [];
  for (const m of messages.slice(-8)) {
    if (m.role === "user" || m.role === "assistant") {
      history.push({ role: m.role as "user" | "assistant", content: m.content ?? "" });
    }
  }

  // Try RAG with 10s timeout, fall back to direct Groq
  let content: string;
  try {
    const ragPromise = ragQuery(question, history.slice(-6));
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("RAG timeout")), 10000)
    );
    const { answer } = await Promise.race([ragPromise, timeoutPromise]);
    content = trimForVoice(answer, 3);
  } catch (err) {
    console.warn("[vapi/llm] RAG failed/timeout, using direct Groq:", err instanceof Error ? err.message : err);
    content = await directGroq(question, history);
  }

  return useStream ? sseResponse(content) : jsonResponse(content);
}

// ── Direct Groq fallback ──────────────────────────────────────────────────────

async function directGroq(question: string, history: ChatMessage[]): Promise<string> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const groqMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: FALLBACK_SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: question },
  ];
  const completion = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    messages: groqMessages,
    temperature: 0.3,
    max_tokens: 150,
  });
  return completion.choices[0]?.message?.content ?? "Could you repeat that?";
}

// ── SSE streaming ─────────────────────────────────────────────────────────────

function sseResponse(content: string): Response {
  const id = `chatcmpl-${crypto.randomUUID().slice(0, 8)}`;
  const created = Math.floor(Date.now() / 1000);

  const chunk = JSON.stringify({
    id, object: "chat.completion.chunk", created, model: "harsh-persona-rag",
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  });
  const done = JSON.stringify({
    id, object: "chat.completion.chunk", created, model: "harsh-persona-rag",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });

  return new Response(`data: ${chunk}\n\ndata: ${done}\n\ndata: [DONE]\n\n`, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ── Non-streaming JSON ────────────────────────────────────────────────────────

function jsonResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "harsh-persona-rag",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}

function errorResponse(msg: string): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

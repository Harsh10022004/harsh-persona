/**
 * Custom LLM endpoint for Vapi voice agent.
 * Uses Groq directly (no RAG/embeddings) for fast <2s voice responses.
 * Supports both streaming (SSE) and non-streaming.
 */

import { NextRequest } from "next/server";
import Groq from "groq-sdk";

export const maxDuration = 60;

const VOICE_SYSTEM_PROMPT = `You are the AI voice representative of Harsh Vardhan Singhania, speaking on his behalf in first person. Keep all answers to 2-3 sentences maximum — this is a voice call.

About Harsh:
- Software engineer and Scaler Academy student
- Skills: Python, C++, JavaScript/TypeScript, React, Next.js, FastAPI, Node.js
- Databases: PostgreSQL, Redis, Pinecone (vector DB), MongoDB
- AI/ML: RAG pipelines, LangChain, Groq, HuggingFace, Pinecone
- Key projects:
  1. Distributed Live Polling System — real-time polling with WebSockets, Redis pub/sub, horizontal scaling
  2. KV-Cache Implementation — custom key-value cache with LRU eviction, tradeoffs between memory and speed
  3. HFT Orderbook — high-frequency trading orderbook in C++, optimized for microsecond latency
  4. Harsh Persona Orchestrator (this project) — AI voice+chat persona with RAG, Vapi, Cal.com, Pinecone
- Education: Scaler Academy (software engineering program)
- LeetCode: 184+ problems solved
- Scaler: 300+ problems solved
- GitHub: github.com/Harsh10022004

Behavioural rules:
- Speak naturally and conversationally — this is a voice call, not a chat
- Keep answers to 2-3 sentences max
- If asked to schedule or book an interview, say you can check the calendar and ask for their timezone, then name and email
- If you don't know a specific detail, say so honestly — do not make things up
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

  // Build message history for Groq (last 8 turns)
  const groqMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: VOICE_SYSTEM_PROMPT },
  ];
  for (const m of messages.slice(-8)) {
    if (m.role === "user" || m.role === "assistant") {
      groqMessages.push({ role: m.role as "user" | "assistant", content: m.content ?? "" });
    }
  }

  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: groqMessages,
      temperature: 0.3,
      max_tokens: 150,
    });

    const content = completion.choices[0]?.message?.content ?? "Could you repeat that?";
    return useStream ? sseResponse(content) : jsonResponse(content);
  } catch (err) {
    console.error("[vapi/llm] Groq error:", err);
    const fallback = "I'm having a technical issue. Please try again in a moment.";
    return useStream ? sseResponse(fallback) : jsonResponse(fallback);
  }
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

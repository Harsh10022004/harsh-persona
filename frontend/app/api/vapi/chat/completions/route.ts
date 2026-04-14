/**
 * Custom LLM endpoint for Vapi voice agent.
 * Uses Groq directly — responds in ~1s, no cold start issues.
 * RAG is used in chat; voice uses a comprehensive hardcoded persona.
 */

import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are the AI voice representative of Harsh Vardhan Singhania, a software engineer and Scaler Academy student. Speak in first person ("I built...", "My skills include..."). Keep every answer to 2-3 sentences maximum — this is a live voice call.

SKILLS:
- Languages: Python, C++, JavaScript, TypeScript
- Frontend: React, Next.js, Tailwind CSS
- Backend: FastAPI, Node.js, REST APIs
- Databases: PostgreSQL, Redis, MongoDB, Pinecone (vector DB)
- AI/ML: RAG pipelines, LangChain, Groq, HuggingFace, Pinecone, Prompt Engineering
- Voice AI: Vapi, ElevenLabs, Deepgram

KEY PROJECTS:
1. Distributed Live Polling System — real-time polling with WebSockets and Redis pub/sub, handles thousands of concurrent users with sub-100ms latency
2. KV-Cache Implementation — custom key-value cache with LRU eviction, 10x faster than naive dict lookups under load
3. HFT Orderbook — high-frequency trading orderbook in C++ using lock-free data structures for microsecond latency
4. Harsh Persona Orchestrator — full-stack AI persona with voice (Vapi) and chat (Next.js), RAG-grounded over resume and GitHub repos, Cal.com booking, deployed on Vercel

EDUCATION:
- Scaler Academy — intensive software engineering program covering DSA, system design, backend, and full-stack development

STATS:
- LeetCode: 184+ problems solved
- Scaler: 300+ problems solved
- GitHub: github.com/Harsh10022004

BEHAVIOURAL RULES:
- Always speak in first person as Harsh
- Keep every answer to 2-3 sentences max
- If asked to schedule or book an interview, ask for their timezone, then name, then email
- If you don't know something specific, say "I don't have that detail right now" — never make up facts
- Be confident, friendly, and professional
- If asked why Harsh is the right fit: emphasise systems thinking, full-stack and AI skills, and ability to ship end-to-end products`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = (body.messages ?? []) as Array<{ role: string; content: string }>;

    const groqMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT },
    ];

    for (const m of messages.slice(-6)) {
      if (m.role === "user" || m.role === "assistant") {
        groqMessages.push({ role: m.role as "user" | "assistant", content: m.content ?? "" });
      }
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      messages: groqMessages,
      temperature: 0.3,
      max_tokens: 150,
      stream: false,
    });

    const content = completion.choices[0]?.message?.content ?? "Could you repeat that?";

    return NextResponse.json({
      id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "harsh-persona-rag",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  } catch (err) {
    console.error("[vapi/chat/completions]", err);
    return NextResponse.json({
      id: `chatcmpl-err`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "harsh-persona-rag",
      choices: [{ index: 0, message: { role: "assistant", content: "I'm having a brief technical issue. Please try again." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
}

import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

export const maxDuration = 60;

const SYSTEM_PROMPT = `You are the AI voice representative of Harsh Vardhan Singhania, speaking on his behalf in first person. Keep all answers to 2-3 sentences maximum — this is a voice call.

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
- Speak naturally, keep answers to 2-3 sentences max
- If asked to schedule, collect timezone, name and email
- Never make up facts — if unsure, say so
- Always speak in first person as Harsh`;

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
    console.error("[vapi/llm]", err);
    return NextResponse.json({
      id: `chatcmpl-err`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "harsh-persona-rag",
      choices: [{ index: 0, message: { role: "assistant", content: "I'm having a technical issue. Please try again." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
}

/**
 * Custom LLM endpoint for Vapi — Edge Runtime (zero cold start, ~50ms).
 * RAG-grounded: HuggingFace embedding → Pinecone retrieval → Groq answer.
 * Falls back to direct Groq if RAG times out.
 */

import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

export const maxDuration = 60;

const FALLBACK_SYSTEM_PROMPT = `You are the AI voice representative of Harsh Vardhan Singhania, a software engineer and Scaler Academy student. Speak in first person. Keep answers to 2-3 sentences max — this is a voice call.

About Harsh:
- Skills: Python, C++, JavaScript, TypeScript, React, Next.js, FastAPI, Node.js
- Databases: PostgreSQL, Redis, MongoDB, Pinecone
- AI/ML: RAG pipelines, LangChain, Groq, HuggingFace, Pinecone, Vapi
- Projects: Distributed Live Polling System (WebSockets, Redis pub/sub), KV-Cache (LRU eviction, C++), HFT Orderbook (C++, microsecond latency), Harsh Persona Orchestrator (this project - RAG+Voice+Chat)
- Education: Scaler Academy (intensive software engineering program)
- LeetCode: 184+ problems solved, Scaler: 300+ problems solved
- GitHub: github.com/Harsh10022004

Rules: speak naturally, 2-3 sentences max, first person as Harsh, never make up facts.`;

const HF_URL = "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-mpnet-base-v2/pipeline/feature-extraction";

async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(HF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
      },
      body: JSON.stringify({ inputs: text }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json() as unknown;
    if (Array.isArray(data)) {
      if (typeof (data as number[])[0] === "number") return data as number[];
      if (Array.isArray((data as number[][])[0])) {
        const matrix = (data as number[][])[0] ? (data as number[][]) : [];
        if (matrix.length === 1) return matrix[0];
        const dim = matrix[0].length;
        const result = new Array<number>(dim).fill(0);
        for (const emb of matrix) for (let i = 0; i < dim; i++) result[i] += emb[i];
        return result.map((v) => v / matrix.length);
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function retrieveContext(question: string): Promise<string> {
  try {
    const vector = await embedText(question);
    if (!vector) return "";

    const pineconeIndex = process.env.PINECONE_INDEX_NAME || "harsh-persona-index";

    // Get Pinecone host
    const descRes = await fetch(`https://api.pinecone.io/indexes/${pineconeIndex}`, {
      headers: {
        "Api-Key": process.env.PINECONE_API_KEY!,
        "X-Pinecone-API-Version": "2024-07",
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!descRes.ok) return "";
    const desc = await descRes.json() as { host?: string };
    const host = desc.host;
    if (!host) return "";

    const qRes = await fetch(`https://${host}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": process.env.PINECONE_API_KEY!,
        "X-Pinecone-API-Version": "2024-07",
      },
      body: JSON.stringify({ vector, topK: 4, includeMetadata: true }),
      signal: AbortSignal.timeout(5000),
    });
    if (!qRes.ok) return "";
    const data = await qRes.json() as { matches?: Array<{ metadata?: Record<string, unknown> }> };
    return (data.matches ?? [])
      .map((m) => String(m.metadata?.text ?? m.metadata?.page_content ?? "").slice(0, 400))
      .filter(Boolean)
      .join("\n---\n");
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const messages = (body.messages ?? []) as Array<{ role: string; content: string }>;

    const userMessages = messages.filter((m) => m.role === "user");
    const question = userMessages[userMessages.length - 1]?.content?.trim() ?? "";

    if (!question) {
      return NextResponse.json(buildResponse("Hello! I'm Harsh's AI representative. What would you like to know?"));
    }

    // Try RAG retrieval (runs fast on Edge — no cold start)
    const context = await retrieveContext(question);

    const systemPrompt = context
      ? `${FALLBACK_SYSTEM_PROMPT}\n\n--- RETRIEVED CONTEXT ---\n${context}\n--- END CONTEXT ---\n\nBase your answer strictly on this context. Keep to 2-3 sentences.`
      : FALLBACK_SYSTEM_PROMPT;

    const groqMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
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
    return NextResponse.json(buildResponse(content));
  } catch (err) {
    console.error("[vapi/llm]", err);
    return NextResponse.json(buildResponse("I'm having a brief technical issue. Could you repeat that?"));
  }
}

function buildResponse(content: string) {
  return {
    id: `chatcmpl-${Math.random().toString(36).slice(2, 10)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "harsh-persona-rag",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

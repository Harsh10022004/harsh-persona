/**
 * Custom LLM endpoint for Vapi voice agent.
 * RAG-grounded: HuggingFace embedding → Pinecone retrieval → Groq answer.
 * Falls back to hardcoded prompt if RAG times out (3s budget).
 * Supports streaming (required for Vapi voice).
 */

import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

export const maxDuration = 60;

const BASE_SYSTEM_PROMPT = `You are the AI voice representative of Harsh Vardhan Singhania, a software engineer and Scaler Academy student. Speak in first person ("I built...", "My skills include..."). Keep every answer to 2-3 sentences maximum — this is a live voice call.

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

const HF_URL =
  "https://router.huggingface.co/hf-inference/models/sentence-transformers/all-mpnet-base-v2/pipeline/feature-extraction";

async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(HF_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
      },
      body: JSON.stringify({ inputs: text }),
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    if (Array.isArray(data)) {
      if (typeof (data as number[])[0] === "number") return data as number[];
      if (Array.isArray((data as number[][])[0])) {
        const matrix = data as number[][];
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

    const descRes = await fetch(`https://api.pinecone.io/indexes/${pineconeIndex}`, {
      headers: {
        "Api-Key": process.env.PINECONE_API_KEY!,
        "X-Pinecone-API-Version": "2024-07",
      },
      signal: AbortSignal.timeout(2000),
    });
    if (!descRes.ok) return "";
    const desc = (await descRes.json()) as { host?: string };
    if (!desc.host) return "";

    const qRes = await fetch(`https://${desc.host}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": process.env.PINECONE_API_KEY!,
        "X-Pinecone-API-Version": "2024-07",
      },
      body: JSON.stringify({ vector, topK: 3, includeMetadata: true }),
      signal: AbortSignal.timeout(2000),
    });
    if (!qRes.ok) return "";
    const data = (await qRes.json()) as {
      matches?: Array<{ metadata?: Record<string, unknown> }>;
    };
    return (data.matches ?? [])
      .map((m) => String(m.metadata?.text ?? m.metadata?.page_content ?? "").slice(0, 350))
      .filter(Boolean)
      .join("\n---\n");
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = (body.messages ?? []) as Array<{ role: string; content: string }>;
    const isStream = body.stream === true;

    // Extract last user question for RAG
    const userMessages = messages.filter((m) => m.role === "user");
    const question = userMessages[userMessages.length - 1]?.content?.trim() ?? "";

    // Run RAG with 3s total budget — falls back to base prompt if too slow
    const context = question
      ? await Promise.race([
          retrieveContext(question),
          new Promise<string>((resolve) => setTimeout(() => resolve(""), 3000)),
        ])
      : "";

    const systemPrompt = context
      ? `${BASE_SYSTEM_PROMPT}\n\n--- RETRIEVED CONTEXT ---\n${context}\n--- END CONTEXT ---\n\nBase your answer on this context where relevant. Keep to 2-3 sentences.`
      : BASE_SYSTEM_PROMPT;

    const groqMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];
    for (const m of messages.slice(-6)) {
      if (m.role === "user" || m.role === "assistant") {
        groqMessages.push({ role: m.role as "user" | "assistant", content: m.content ?? "" });
      }
    }

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    if (isStream) {
      const completion = await groq.chat.completions.create({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        messages: groqMessages,
        temperature: 0.3,
        max_tokens: 150,
        stream: true,
      });

      const encoder = new TextEncoder();
      const readable = new ReadableStream({
        async start(controller) {
          try {
            for await (const chunk of completion) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    // Non-streaming fallback
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
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "I'm having a brief technical issue. Please try again.",
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
}

/**
 * Custom LLM endpoint — OpenAI chat-completion compatible.
 * Supports both streaming (SSE) and non-streaming responses.
 * Vapi sends stream:true by default — we must handle it.
 */

import { NextRequest, NextResponse } from "next/server";
import { ragQuery, trimForVoice, ChatMessage } from "@/lib/rag";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = (body.messages ?? []) as Array<{ role: string; content: string }>;
  const stream = body.stream === true;

  // Find the last user message
  const userMessages = messages.filter((m) => m.role === "user");
  if (!userMessages.length) {
    const content = "Hello! I'm Harsh's AI representative. What would you like to know?";
    return stream ? streamResponse(content) : NextResponse.json(buildResponse(content));
  }

  const question = userMessages[userMessages.length - 1].content?.trim() ?? "";
  if (!question) {
    const content = "Could you please repeat that?";
    return stream ? streamResponse(content) : NextResponse.json(buildResponse(content));
  }

  // Build conversation history
  const history: ChatMessage[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const m = messages[i];
    if (m.role === "user" || m.role === "assistant") {
      history.push({ role: m.role as "user" | "assistant", content: m.content ?? "" });
    }
  }

  try {
    const { answer } = await ragQuery(question, history.slice(-8));
    const voiceAnswer = trimForVoice(answer, 3);
    return stream ? streamResponse(voiceAnswer) : NextResponse.json(buildResponse(voiceAnswer));
  } catch (err) {
    console.error("[vapi/llm] ragQuery error:", err);
    const content = "I'm having a small technical issue. Could you give me a moment and try again?";
    return stream ? streamResponse(content) : NextResponse.json(buildResponse(content));
  }
}

// ── SSE streaming response (what Vapi expects) ────────────────────────────────

function streamResponse(content: string): Response {
  const id = `chatcmpl-${crypto.randomUUID().slice(0, 8)}`;
  const created = Math.floor(Date.now() / 1000);

  // Send content as a single SSE chunk, then [DONE]
  const chunk = {
    id,
    object: "chat.completion.chunk",
    created,
    model: "harsh-persona-rag",
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
  };

  const done = {
    id,
    object: "chat.completion.chunk",
    created,
    model: "harsh-persona-rag",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };

  const body = `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(done)}\n\ndata: [DONE]\n\n`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ── Non-streaming response ────────────────────────────────────────────────────

function buildResponse(content: string) {
  return {
    id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "harsh-persona-rag",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

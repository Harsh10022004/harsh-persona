/**
 * Custom LLM endpoint — OpenAI chat-completion compatible.
 *
 * Vapi calls this on every conversational turn instead of hitting
 * OpenAI directly, giving us full RAG control.
 *
 * Vapi sends:
 *   { messages: [{role, content}...], call: {...}, model: "..." }
 *
 * We respond with the OpenAI chat completion shape.
 * For tool calls, Vapi intercepts and calls /api/voice with the result.
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

  // Find the last user message
  const userMessages = messages.filter((m) => m.role === "user");
  if (!userMessages.length) {
    return NextResponse.json(
      buildResponse("Hello! I'm Harsh's AI representative. What would you like to know?")
    );
  }

  const question = userMessages[userMessages.length - 1].content?.trim() ?? "";
  if (!question) {
    return NextResponse.json(buildResponse("Could you please repeat that?"));
  }

  // Build conversation history (exclude system messages — RAG builds its own)
  const history: ChatMessage[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const m = messages[i];
    if (m.role === "user" || m.role === "assistant") {
      history.push({ role: m.role as "user" | "assistant", content: m.content ?? "" });
    }
  }

  try {
    const { answer } = await ragQuery(question, history.slice(-8));
    // Trim to 2-3 sentences for voice — keep it concise
    const voiceAnswer = trimForVoice(answer, 3);
    return NextResponse.json(buildResponse(voiceAnswer));
  } catch (err) {
    console.error("[vapi/llm] ragQuery error:", err);
    return NextResponse.json(
      buildResponse(
        "I'm having a small technical issue. Could you give me a moment and try again?"
      )
    );
  }
}

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

/**
 * Custom LLM endpoint — OpenAI chat-completion compatible.
 *
 * Vapi calls this on every conversational turn instead of hitting
 * OpenAI directly, giving us full RAG control and < 2s latency.
 */

import { NextRequest, NextResponse } from "next/server";
import { ragQuery, trimForVoice, ChatMessage } from "@/lib/rag";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const messages = (body.messages ?? []) as Array<{ role: string; content: string }>;

  const userMsgs = messages.filter((m) => m.role === "user");
  if (!userMsgs.length) {
    const fallback = "Hello! I'm Harsh's AI representative. What would you like to know?";
    return NextResponse.json(buildResponse(fallback));
  }

  const question = userMsgs[userMsgs.length - 1].content.trim();

  // Build conversation history (last 5 turns)
  const history: ChatMessage[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const m = messages[i];
    if (m.role === "user" || m.role === "assistant") {
      history.push({ role: m.role as "user" | "assistant", content: m.content });
    }
  }

  const { answer } = await ragQuery(question, history.slice(-10));
  const voiceAnswer = trimForVoice(answer, 3);

  return NextResponse.json(buildResponse(voiceAnswer));
}

function buildResponse(content: string) {
  return {
    id: `chatcmpl-${crypto.randomUUID().slice(0, 8)}`,
    object: "chat.completion",
    model: "harsh-persona-rag",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

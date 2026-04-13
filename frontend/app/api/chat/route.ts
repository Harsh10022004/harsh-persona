import { NextRequest, NextResponse } from "next/server";
import { ragQuery } from "@/lib/rag";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history = [], session_id } = body;

    if (!message?.trim()) {
      return NextResponse.json({ error: "message is required" }, { status: 400 });
    }

    const { answer, sources } = await ragQuery(message, history);

    return NextResponse.json({
      response: answer,
      sources,
      session_id: session_id ?? crypto.randomUUID(),
    });
  } catch (err) {
    console.error("[/api/chat]", err);
    return NextResponse.json({ error: "Knowledge retrieval failed." }, { status: 500 });
  }
}

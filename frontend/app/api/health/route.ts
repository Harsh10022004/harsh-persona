import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    llm_provider: "GROQ",
    embeddings: "gemini-text-embedding-004",
    runtime: "next.js",
  });
}

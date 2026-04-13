/**
 * RAG — Retrieval-Augmented Generation.
 *
 * Flow:
 *   1. Embed the user question via HuggingFace (all-mpnet-base-v2)
 *   2. Retrieve top-12 chunks from Pinecone
 *   3. Build a grounded system prompt with the retrieved context
 *   4. Call Groq (llama-3.3-70b-versatile) for the answer
 */

import Groq from "groq-sdk";
import { embedText } from "./embeddings";
import { similaritySearch, PineconeMatch } from "./pinecone";

// ── System prompt ──────────────────────────────────────────────────────────────

const SYSTEM_TEMPLATE = `You are the AI representative of Harsh Vardhan Singhania, a software engineer and Scaler Academy student. You speak on Harsh's behalf in first person ("I built...", "My experience includes...").

Your knowledge base contains:
- Harsh's full resume (education, experience, projects, skills, achievements)
- Detailed profiles (LinkedIn, GitHub, LeetCode stats, Scaler profile)
- Code-level analysis of all GitHub repositories (class/function level)
- Structured summaries of each repo (tech stack, purpose, architecture, tradeoffs)

Behavioural rules:
- Base EVERY claim strictly on the retrieved context below. Never invent facts.
- If the context does not contain the answer, say: "I don't have that specific detail in my knowledge base right now."
- For resume questions: reference specific sections (education, experience, projects, skills).
- For project/repo questions: mention the tech stack, purpose, architecture, and any tradeoffs from the context.
- For codebase questions: reference specific classes, functions, and design patterns found in the context.
- For "why hire me" questions: synthesise skills, projects, and experience into a compelling, specific answer.
- Chat answers should be detailed and specific — cite actual project names, technologies, and numbers.
- Voice answers: keep to 2-3 sentences max.
- When asked about scheduling, direct the user to the calendar booking widget.

--- RETRIEVED CONTEXT ---
{context}
--- END CONTEXT ---`;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SourceCitation {
  source_type: string;
  repo_name: string;
  section: string;
}

export interface RAGResult {
  answer: string;
  sources: SourceCitation[];
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function ragQuery(
  question: string,
  history: ChatMessage[] = []
): Promise<RAGResult> {
  // 1. Embed the question
  const queryVector = await embedText(question);

  // 2. Retrieve from Pinecone — k=12 for comprehensive coverage
  const matches = await similaritySearch(queryVector, 6);

  // 3. Build context string
  const context = buildContext(matches);

  // 4. Assemble messages
  const systemPrompt = SYSTEM_TEMPLATE.replace("{context}", context);
  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
    ...history.slice(-10),
    { role: "user", content: question },
  ];

  // 5. Call Groq
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  const completion = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    messages,
    temperature: 0.2,
    max_tokens: 800,
  });

  const answer = completion.choices[0]?.message?.content ?? "";

  // 6. Build source citations
  const sources: SourceCitation[] = matches.slice(0, 3).map((m) => ({
    source_type: String(m.metadata?.source_type ?? ""),
    repo_name: String(m.metadata?.repo_name ?? ""),
    section: String(m.metadata?.section ?? ""),
  }));

  return { answer, sources };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildContext(matches: PineconeMatch[]): string {
  if (!matches.length) return "No relevant context retrieved.";

  return matches
    .map((m) => {
      const meta = m.metadata ?? {};
      const src = String(meta.source_type ?? "unknown");
      const repo = String(meta.repo_name ?? "");
      const section = String(meta.section ?? "");
      const score = m.score ? ` (relevance: ${(m.score * 100).toFixed(0)}%)` : "";
      const label = `[${src}${repo ? ": " + repo : ""}${section ? " / " + section : ""}${score}]`;
      const content = String(meta.text ?? meta.page_content ?? "").slice(0, 500);
      return `${label}\n${content}`;
    })
    .join("\n\n---\n\n");
}

// ── Voice helper ───────────────────────────────────────────────────────────────

export function trimForVoice(text: string, maxSentences = 3): string {
  const sentences = text.trim().split(/(?<=[.!?])\s+/);
  return sentences.slice(0, maxSentences).join(" ");
}

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import MessageBubble, { Message } from "./MessageBubble";
import BookingModal from "./BookingModal";

const SUGGESTED_QUESTIONS = [
  "Why is Harsh the right fit for this role?",
  "Tell me about the distributed live polling system.",
  "What is the kv-cache project and its tradeoffs?",
  "What is Harsh's tech stack and key skills?",
  "How many LeetCode problems has Harsh solved?",
  "Walk me through the HFT orderbook project.",
];

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I'm Harsh Vardhan Singhania's AI representative. Ask me anything about his background, projects, skills, or availability — or click a suggestion below to get started.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string>(() => uuidv4());
  const [isLoading, setIsLoading] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [bookingConfirm, setBookingConfirm] = useState("");

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      const userMsg: Message = { id: uuidv4(), role: "user", content: trimmed };
      const loadingMsg: Message = { id: "loading", role: "assistant", content: "", isLoading: true };

      setMessages((prev) => [...prev, userMsg, loadingMsg]);
      setInput("");
      setIsLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, session_id: sessionId }),
        });

        if (!res.ok) throw new Error(`Server error ${res.status}`);
        const data = await res.json();

        const assistantMsg: Message = {
          id: uuidv4(),
          role: "assistant",
          content: data.response ?? "I couldn't generate a response.",
          sources: data.sources ?? [],
        };
        if (data.session_id) setSessionId(data.session_id);
        setMessages((prev) => [...prev.filter((m) => m.id !== "loading"), assistantMsg]);
      } catch {
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== "loading"),
          {
            id: uuidv4(),
            role: "assistant",
            content: "Sorry, I ran into an error. Please try again.",
          },
        ]);
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [isLoading, sessionId]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex-shrink-0 border-b border-slate-800 bg-slate-900/80 backdrop-blur-md px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-600 flex items-center justify-center font-bold text-sm">
              HV
            </div>
            <div>
              <h1 className="font-semibold text-white leading-tight">Harsh Vardhan Singhania</h1>
              <p className="text-xs text-slate-400">AI Representative · RAG-grounded</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-slate-500">
              Powered by Gemini + Pinecone
            </span>
            <button
              onClick={() => setShowBooking(true)}
              className="px-4 py-1.5 text-sm font-medium bg-brand-600 hover:bg-brand-700 text-white rounded-xl transition-colors"
            >
              Book Interview
            </button>
          </div>
        </div>
      </header>

      {/* ── Booking confirmation banner ─────────────────────────────────────── */}
      {bookingConfirm && (
        <div className="flex-shrink-0 bg-emerald-900 border-b border-emerald-700 px-6 py-2.5 text-sm text-emerald-200 text-center animate-fade-in">
          Meeting booked! Confirmation ref: <span className="font-mono font-semibold">{bookingConfirm}</span>.
          Check your email for the calendar invite.
        </div>
      )}

      {/* ── Messages ────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </main>

      {/* ── Suggested questions ──────────────────────────────────────────────── */}
      {messages.length <= 2 && !isLoading && (
        <div className="flex-shrink-0 px-4 pb-2">
          <div className="max-w-3xl mx-auto flex flex-wrap gap-2">
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => sendMessage(q)}
                className="text-xs px-3 py-1.5 rounded-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Input area ──────────────────────────────────────────────────────── */}
      <footer className="flex-shrink-0 border-t border-slate-800 bg-slate-900/80 backdrop-blur-md px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-end gap-3">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about projects, skills, background..."
            disabled={isLoading}
            className="flex-1 resize-none bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors max-h-32 leading-relaxed"
            style={{ overflowY: "auto" }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
            className="flex-shrink-0 w-11 h-11 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <p className="text-center text-[10px] text-slate-600 mt-2">
          Answers are grounded in Harsh&apos;s actual resume and GitHub repos — no hallucinations.
          Shift+Enter for new line.
        </p>
      </footer>

      {/* ── Booking modal ───────────────────────────────────────────────────── */}
      {showBooking && (
        <BookingModal
          onClose={() => setShowBooking(false)}
          onBooked={(uid) => {
            setShowBooking(false);
            setBookingConfirm(uid);
          }}
        />
      )}
    </div>
  );
}

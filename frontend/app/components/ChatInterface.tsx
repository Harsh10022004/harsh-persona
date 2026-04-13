"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import MessageBubble, { Message, SlotOption, DayGroup } from "./MessageBubble";
import BookingModal from "./BookingModal";

const SUGGESTED_QUESTIONS = [
  "Why is Harsh the right fit for this role?",
  "Tell me about the distributed live polling system.",
  "What is the kv-cache project and its tradeoffs?",
  "What is Harsh's tech stack and key skills?",
  "How many LeetCode problems has Harsh solved?",
  "Walk me through the HFT orderbook project.",
  "Can I schedule an interview with Harsh?",
];

const BOOKING_KEYWORDS = [
  "book", "schedule", "interview", "meeting", "slot", "calendar",
  "availability", "available", "appointment", "call with harsh",
  "connect with harsh", "hire", "recruit", "set up a", "arrange",
  "when is harsh", "when can i", "can i schedule", "can we schedule",
  "can i book", "can we book",
];

type BookingStep = "idle" | "showing_slots" | "awaiting_name" | "awaiting_email" | "booking";

interface BookingContext {
  step: BookingStep;
  selectedSlot: string;
  guestName: string;
}

function isBookingIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return BOOKING_KEYWORDS.some((kw) => lower.includes(kw));
}

function formatSlotLabel(isoTime: string, tz: string): string {
  try {
    const d = new Date(isoTime);
    return d.toLocaleString("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoTime;
  }
}

function formatTimeOnly(isoTime: string, tz: string): string {
  try {
    return new Date(isoTime).toLocaleString("en-US", {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoTime;
  }
}

function formatDayLabel(dateKey: string, tz: string): string {
  try {
    // dateKey is "YYYY-MM-DD"; parse as local noon to avoid timezone day-shift
    const d = new Date(`${dateKey}T12:00:00`);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return dateKey;
  }
}

function buildDayGroups(
  slotsMap: Record<string, Array<{ time: string }>>,
  tz: string
): DayGroup[] {
  return Object.keys(slotsMap)
    .sort()
    .map((dateKey) => {
      const rawSlots = slotsMap[dateKey] ?? [];
      const slots: SlotOption[] = rawSlots.map(({ time }) => ({
        isoTime: time,
        label: formatTimeOnly(time, tz),
      }));
      const first = slots[0]?.label ?? "";
      const last = slots[slots.length - 1]?.label ?? "";
      const range = first === last ? first : `${first} – ${last}`;
      return {
        dateKey,
        dayLabel: formatDayLabel(dateKey, tz),
        range,
        slots,
      };
    })
    .filter((g) => g.slots.length > 0);
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I'm Harsh Vardhan Singhania's AI representative. Ask me anything about his background, projects, skills — or ask to schedule an interview and I'll help you book a slot right here in chat.",
    },
  ]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string>(() => uuidv4());
  const [isLoading, setIsLoading] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [bookingConfirm, setBookingConfirm] = useState("");

  // Inline booking state machine
  const [bookingCtx, setBookingCtx] = useState<BookingContext>({
    step: "idle",
    selectedSlot: "",
    guestName: "",
  });
  // Message IDs for wiring callbacks on re-render
  const [dayMsgId, setDayMsgId] = useState<string | null>(null);
  const [slotMsgId, setSlotMsgId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Day selection handler (level 1) ────────────────────────────────────────
  const handleDaySelect = useCallback((group: DayGroup) => {
    // Remove day chips
    setDayMsgId(null);
    setMessages((prev) =>
      prev.map((m) => (m.dayGroups ? { ...m, dayGroups: undefined, onDaySelect: undefined } : m))
    );

    const msgId = uuidv4();
    const timeMsg: Message = {
      id: msgId,
      role: "assistant",
      content: `${group.dayLabel} works. Pick a time:`,
      slotOptions: group.slots,
    };
    setSlotMsgId(msgId);
    setMessages((prev) => [...prev, timeMsg]);
    setBookingCtx((c) => ({ ...c, step: "showing_slots" }));
    inputRef.current?.focus();
  }, []);

  // ── Slot selection handler (level 2) ────────────────────────────────────────
  const handleSlotSelect = useCallback(
    (isoTime: string) => {
      setSlotMsgId(null);
      setMessages((prev) =>
        prev.map((m) =>
          m.slotOptions ? { ...m, slotOptions: undefined, onSlotSelect: undefined } : m
        )
      );

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const label = formatSlotLabel(isoTime, tz);
      const userMsg: Message = { id: uuidv4(), role: "user", content: `I'll take the ${label} slot.` };
      const askName: Message = {
        id: uuidv4(),
        role: "assistant",
        content: `Great choice! Locking in **${label}** for you. What's your full name?`,
      };
      setMessages((prev) => [...prev, userMsg, askName]);
      setBookingCtx({ step: "awaiting_name", selectedSlot: isoTime, guestName: "" });
      inputRef.current?.focus();
    },
    []
  );

  // ── Fetch availability and post slot message ────────────────────────────────
  const fetchAndShowSlots = useCallback(async () => {
    const loadingMsg: Message = { id: "loading", role: "assistant", content: "", isLoading: true };
    setMessages((prev) => [...prev, loadingMsg]);
    setIsLoading(true);

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch(`/api/availability?tz=${encodeURIComponent(tz)}`);
      const data = await res.json();

      const dayGroups = buildDayGroups(data.slots ?? {}, tz);
      const msgId = uuidv4();

      const slotMsg: Message =
        dayGroups.length === 0
          ? {
              id: msgId,
              role: "assistant",
              content:
                "It looks like there are no open slots in the next 7 days. Please reach out via email to coordinate directly.",
            }
          : {
              id: msgId,
              role: "assistant",
              content: "Here are the available days. Click a day to see the time slots:",
              dayGroups,
            };

      setDayMsgId(dayGroups.length > 0 ? msgId : null);
      setSlotMsgId(null);
      setMessages((prev) => [...prev.filter((m) => m.id !== "loading"), slotMsg]);
      if (dayGroups.length > 0) {
        setBookingCtx((c) => ({ ...c, step: "showing_slots" }));
      } else {
        setBookingCtx((c) => ({ ...c, step: "idle" }));
      }
    } catch {
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== "loading"),
        { id: uuidv4(), role: "assistant", content: "Sorry, I couldn't fetch availability right now. Please try again." },
      ]);
      setBookingCtx((c) => ({ ...c, step: "idle" }));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, []);

  // ── Book the slot ───────────────────────────────────────────────────────────
  const doBooking = useCallback(async (name: string, email: string, slot: string) => {
    const loadingMsg: Message = { id: "loading", role: "assistant", content: "", isLoading: true };
    setMessages((prev) => [...prev, loadingMsg]);
    setIsLoading(true);

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, start_time: slot, timezone: tz }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error ?? `Booking failed (${res.status})`);
      }

      const uid: string = data.uid ?? data.id ?? "confirmed";
      const label = formatSlotLabel(slot, tz);
      const confirmMsg: Message = {
        id: uuidv4(),
        role: "assistant",
        content: `Your interview is confirmed! 🎉\n\n**Time:** ${label}\n**Name:** ${name}\n**Email:** ${email}\n**Ref:** \`${uid}\`\n\nYou'll receive a calendar invite at ${email}. Looking forward to speaking with you!`,
      };
      setMessages((prev) => [...prev.filter((m) => m.id !== "loading"), confirmMsg]);
      setBookingConfirm(uid);
      setBookingCtx({ step: "idle", selectedSlot: "", guestName: "" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Booking failed.";
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== "loading"),
        { id: uuidv4(), role: "assistant", content: `Sorry, booking failed: ${msg}. Please try again.` },
      ]);
      setBookingCtx({ step: "idle", selectedSlot: "", guestName: "" });
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, []);

  // ── Main send ───────────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;
      setInput("");

      // ── Booking state machine ──
      if (bookingCtx.step === "awaiting_name") {
        const userMsg: Message = { id: uuidv4(), role: "user", content: trimmed };
        const askEmail: Message = {
          id: uuidv4(),
          role: "assistant",
          content: `Thanks, ${trimmed}! What's your email address so we can send the calendar invite?`,
        };
        setMessages((prev) => [...prev, userMsg, askEmail]);
        setBookingCtx((c) => ({ ...c, guestName: trimmed, step: "awaiting_email" }));
        return;
      }

      if (bookingCtx.step === "awaiting_email") {
        const userMsg: Message = { id: uuidv4(), role: "user", content: trimmed };
        setMessages((prev) => [...prev, userMsg]);
        setBookingCtx((c) => ({ ...c, step: "booking" }));
        await doBooking(bookingCtx.guestName, trimmed, bookingCtx.selectedSlot);
        return;
      }

      // ── Booking intent detection ──
      if (bookingCtx.step === "idle" && isBookingIntent(trimmed)) {
        const userMsg: Message = { id: uuidv4(), role: "user", content: trimmed };
        const fetchingMsg: Message = {
          id: uuidv4(),
          role: "assistant",
          content: "Let me check the available slots for you...",
        };
        setMessages((prev) => [...prev, userMsg, fetchingMsg]);
        await fetchAndShowSlots();
        return;
      }

      // ── Normal RAG query ──
      const userMsg: Message = { id: uuidv4(), role: "user", content: trimmed };
      const loadingMsg: Message = { id: "loading", role: "assistant", content: "", isLoading: true };
      setMessages((prev) => [...prev, userMsg, loadingMsg]);
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
          { id: uuidv4(), role: "assistant", content: "Sorry, I ran into an error. Please try again." },
        ]);
      } finally {
        setIsLoading(false);
        inputRef.current?.focus();
      }
    },
    [isLoading, sessionId, bookingCtx, fetchAndShowSlots, doBooking, handleDaySelect]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // Placeholder text that adapts to booking step
  const placeholder =
    bookingCtx.step === "awaiting_name"
      ? "Enter your full name..."
      : bookingCtx.step === "awaiting_email"
      ? "Enter your email address..."
      : "Ask about projects, skills, background...";

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
              Powered by Groq + Pinecone
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
          Interview booked! Ref: <span className="font-mono font-semibold">{bookingConfirm}</span> — check your email for the calendar invite.
        </div>
      )}

      {/* ── Messages ────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-4">
          {messages.map((msg) => {
            let m = msg;
            if (msg.id === dayMsgId) m = { ...m, onDaySelect: handleDaySelect };
            if (msg.id === slotMsgId) m = { ...m, onSlotSelect: handleSlotSelect };
            return <MessageBubble key={msg.id} message={m} />;
          })}
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
            placeholder={placeholder}
            disabled={isLoading || bookingCtx.step === "booking"}
            className="flex-1 resize-none bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors max-h-32 leading-relaxed"
            style={{ overflowY: "auto" }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim() || bookingCtx.step === "booking"}
            className="flex-shrink-0 w-11 h-11 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
            aria-label="Send"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
        <p className="text-center text-[10px] text-slate-600 mt-2">
          Answers are grounded in Harsh&apos;s actual resume and GitHub repos.
          {bookingCtx.step === "idle" && " · Ask \"schedule an interview\" to book inline."}
          {bookingCtx.step !== "idle" && " · Complete the booking above to continue."}
        </p>
      </footer>

      {/* ── Booking modal (header button) ───────────────────────────────────── */}
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

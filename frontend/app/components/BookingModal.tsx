"use client";

import React, { useCallback, useEffect, useState } from "react";

interface Slot {
  time: string;  // ISO 8601
}

interface Props {
  onClose: () => void;
  onBooked: (confirmationUid: string) => void;
}

function formatSlot(isoTime: string): string {
  try {
    return new Date(isoTime).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return isoTime;
  }
}

export default function BookingModal({ onClose, onBooked }: Props) {
  const [slots, setSlots] = useState<Array<{ date: string; times: Slot[] }>>([]);
  const [loadingSlots, setLoadingSlots] = useState(true);
  const [slotError, setSlotError] = useState("");

  const [selectedSlot, setSelectedSlot] = useState<string>("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Fetch available slots on mount
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch(`/api/availability?tz=${encodeURIComponent(tz)}`)
      .then((r) => r.json())
      .then((data) => {
        const raw: Record<string, Slot[]> = data?.slots ?? {};
        const parsed = Object.entries(raw).map(([date, times]) => ({ date, times }));
        setSlots(parsed);
      })
      .catch(() => setSlotError("Could not load availability. Please try again."))
      .finally(() => setLoadingSlots(false));
  }, []);

  const handleBook = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedSlot || !name.trim() || !email.trim()) return;

      setSubmitting(true);
      setSubmitError("");

      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const res = await fetch("/api/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, start_time: selectedSlot, timezone: tz }),
        });

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err?.detail ?? "Booking failed.");
        }

        const booking = await res.json();
        onBooked(booking?.uid ?? "confirmed");
      } catch (err: unknown) {
        setSubmitError(err instanceof Error ? err.message : "Booking failed.");
      } finally {
        setSubmitting(false);
      }
    },
    [selectedSlot, name, email, onBooked]
  );

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg mx-4 p-6 shadow-2xl animate-slide-up">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">Book a 15-min Interview</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        {loadingSlots ? (
          <p className="text-slate-400 text-sm text-center py-8">Loading available slots...</p>
        ) : slotError ? (
          <p className="text-red-400 text-sm text-center py-6">{slotError}</p>
        ) : (
          <form onSubmit={handleBook} className="space-y-4">
            {/* Slot selector */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Select a time slot
              </label>
              {slots.length === 0 ? (
                <p className="text-slate-500 text-sm">No slots available this week.</p>
              ) : (
                <div className="grid grid-cols-1 gap-1.5 max-h-48 overflow-y-auto pr-1">
                  {slots.flatMap(({ times }) =>
                    times.map((t) => (
                      <button
                        key={t.time}
                        type="button"
                        onClick={() => setSelectedSlot(t.time)}
                        className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors ${
                          selectedSlot === t.time
                            ? "border-brand-500 bg-brand-700 text-white"
                            : "border-slate-700 bg-slate-800 text-slate-300 hover:border-brand-600"
                        }`}
                      >
                        {formatSlot(t.time)}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Name */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Your name</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Your email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@company.com"
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-brand-500 transition-colors"
              />
            </div>

            {submitError && (
              <p className="text-red-400 text-xs bg-red-950 rounded-lg px-3 py-2">{submitError}</p>
            )}

            <button
              type="submit"
              disabled={submitting || !selectedSlot || !name || !email}
              className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm transition-colors"
            >
              {submitting ? "Booking..." : "Confirm Booking"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

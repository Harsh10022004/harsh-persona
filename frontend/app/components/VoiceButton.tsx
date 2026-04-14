"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";

type CallStatus = "idle" | "connecting" | "active" | "ending";

interface VoiceButtonProps {
  onTranscript?: (role: "user" | "assistant", text: string) => void;
}

export default function VoiceButton({ onTranscript }: VoiceButtonProps) {
  const vapiRef = useRef<Vapi | null>(null);
  const [status, setStatus] = useState<CallStatus>("idle");
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialise Vapi once
  useEffect(() => {
    const publicKey = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
    if (!publicKey) return;

    const vapi = new Vapi(publicKey);
    vapiRef.current = vapi;

    vapi.on("call-start", () => {
      setStatus("active");
      setError(null);
    });

    vapi.on("call-end", () => {
      setStatus("idle");
      setIsSpeaking(false);
    });

    vapi.on("speech-start", () => setIsSpeaking(true));
    vapi.on("speech-end", () => setIsSpeaking(false));

    vapi.on("message", (msg: unknown) => {
      const m = msg as { type?: string; role?: string; transcript?: string; transcriptType?: string };
      if (m.type === "transcript" && m.transcriptType === "final" && m.transcript) {
        onTranscript?.(m.role === "assistant" ? "assistant" : "user", m.transcript);
      }
    });

    vapi.on("error", (err: unknown) => {
      console.error("[Vapi]", err);
      const e = err as { message?: string };
      setError(e?.message ?? "Call failed");
      setStatus("idle");
    });

    return () => {
      vapi.stop();
    };
  }, [onTranscript]);

  const handleToggle = useCallback(async () => {
    const vapi = vapiRef.current;
    if (!vapi) {
      setError("Vapi not initialised — check NEXT_PUBLIC_VAPI_PUBLIC_KEY");
      return;
    }

    if (status === "active") {
      setStatus("ending");
      vapi.stop();
      return;
    }

    if (status !== "idle") return;

    const assistantId = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;
    if (!assistantId) {
      setError("Assistant ID not configured");
      return;
    }

    setStatus("connecting");
    setError(null);
    try {
      await vapi.start(assistantId);
    } catch (err) {
      const e = err as { message?: string };
      setError(e?.message ?? "Failed to start call");
      setStatus("idle");
    }
  }, [status]);

  const isIdle = status === "idle";
  const isActive = status === "active";
  const isConnecting = status === "connecting" || status === "ending";

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={handleToggle}
        disabled={isConnecting}
        title={isActive ? "End call" : "Start voice call"}
        className={`
          relative flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium
          transition-all duration-200 select-none
          ${isActive
            ? "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30"
            : isConnecting
            ? "bg-gray-600 text-gray-400 cursor-not-allowed"
            : "bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
          }
        `}
      >
        {/* Pulse ring when active */}
        {isActive && (
          <span className="absolute inset-0 rounded-full animate-ping bg-red-400 opacity-20" />
        )}

        {/* Icon */}
        {isConnecting ? (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
        ) : isActive ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8z" />
          </svg>
        )}

        <span>
          {isConnecting
            ? status === "ending" ? "Ending…" : "Connecting…"
            : isActive
            ? isSpeaking ? "Speaking…" : "End Call"
            : "Voice Call"}
        </span>
      </button>

      {error && (
        <p className="text-xs text-red-400 max-w-[180px] text-center">{error}</p>
      )}
    </div>
  );
}

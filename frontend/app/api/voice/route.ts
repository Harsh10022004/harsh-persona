/**
 * Vapi.ai server-side webhook.
 *
 * Handles:
 *   assistant-request  → return assistant config
 *   function-call      → check_availability | book_meeting
 *   end-of-call-report → log call summary
 */

import { NextRequest, NextResponse } from "next/server";
import { getAvailability, createBooking, formatSlotsForVoice } from "@/lib/calendar";

const USER_NAME = (process.env.USER_NAME ?? "Harsh_Vardhan_Singhania").replace(/_/g, " ");
const BACKEND_URL = process.env.BACKEND_URL ?? "https://your-vercel-app.vercel.app";

const FUNCTIONS = [
  {
    name: "check_availability",
    description:
      "Check Harsh's calendar and return available meeting slots. " +
      "Call this when the caller asks about scheduling, availability, or wants to book a meeting.",
    parameters: {
      type: "object",
      properties: {
        timezone: {
          type: "string",
          description: "Caller's IANA timezone, e.g. 'America/New_York'",
        },
      },
    },
  },
  {
    name: "book_meeting",
    description: "Create a confirmed calendar booking with the caller.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Caller's full name" },
        email: { type: "string", description: "Caller's email address" },
        start_time: {
          type: "string",
          description: "ISO 8601 start time, e.g. '2025-05-10T14:00:00Z'",
        },
        timezone: { type: "string", description: "Caller's IANA timezone" },
      },
      required: ["name", "email", "start_time"],
    },
  },
];

function getAssistantConfig() {
  return {
    assistant: {
      name: `${USER_NAME} AI Representative`,
      firstMessage:
        `Hello! I'm the AI representative of ${USER_NAME}, a software engineer. ` +
        "I can tell you about his background, projects, and skills — " +
        "and I can book an interview slot directly. How can I help you today?",
      model: {
        provider: "custom-llm",
        url: `${BACKEND_URL}/api/vapi/llm`,
        model: "harsh-persona-rag",
      },
      voice: {
        provider: "11labs",
        voiceId: "adam",
        stability: 0.5,
        similarityBoost: 0.75,
      },
      transcriber: {
        provider: "deepgram",
        model: "nova-2",
        language: "en-US",
      },
      functions: FUNCTIONS,
      silenceTimeoutSeconds: 30,
      maxDurationSeconds: 600,
      serverUrl: `${BACKEND_URL}/api/voice`,
      serverMessages: ["function-call", "end-of-call-report"],
      endCallMessage:
        "It was great speaking with you! " +
        "You'll receive a calendar confirmation if we booked a slot. Have a great day!",
    },
  };
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = (body.message ?? {}) as Record<string, unknown>;
  const msgType = message.type as string;

  if (msgType === "assistant-request") {
    return NextResponse.json(getAssistantConfig());
  }

  if (msgType === "function-call") {
    const fnCall = (message.functionCall ?? {}) as Record<string, unknown>;
    const fnName = fnCall.name as string;
    const params = (fnCall.parameters ?? {}) as Record<string, string>;

    let result: string;
    if (fnName === "check_availability") {
      try {
        const tz = params.timezone ?? "UTC";
        const avail = await getAvailability(tz);
        result = formatSlotsForVoice(avail);
      } catch (err) {
        console.error("check_availability error:", err);
        result =
          "I'm having trouble reading the calendar right now. " +
          "Please try again in a moment or visit the chat interface.";
      }
    } else if (fnName === "book_meeting") {
      try {
        const booking = await createBooking(
          params.name,
          params.email,
          params.start_time,
          params.timezone ?? "UTC"
        );
        result =
          `All set! I've booked the meeting. ` +
          `A confirmation email is on its way to ${params.email}. ` +
          `Reference: ${booking.uid ?? "confirmed"}.`;
      } catch (err) {
        console.error("book_meeting error:", err);
        result =
          "I ran into an issue creating the booking. " +
          "Please use the chat interface to complete the scheduling.";
      }
    } else {
      result = "I don't know how to handle that request.";
    }

    return NextResponse.json({ result });
  }

  if (msgType === "end-of-call-report") {
    console.log(
      `[Vapi] Call ended — reason=${message.endedReason}, duration=${message.durationSeconds}s`
    );
    return NextResponse.json({ status: "received" });
  }

  return NextResponse.json({ status: "ok" });
}

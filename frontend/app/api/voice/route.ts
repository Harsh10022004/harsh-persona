/**
 * Vapi.ai server-side webhook.
 *
 * Handles:
 *   tool-calls         → check_availability | book_meeting  (current Vapi format)
 *   function-call      → same tools (legacy Vapi format — kept for compatibility)
 *   end-of-call-report → log summary
 *   hang               → call ended unexpectedly
 */

import { NextRequest, NextResponse } from "next/server";
import { getAvailability, createBooking, formatSlotsForVoice } from "@/lib/calendar";

export const maxDuration = 60;

// ── Tool handlers ─────────────────────────────────────────────────────────────

async function handleCheckAvailability(params: Record<string, string>): Promise<string> {
  const tz = params.timezone ?? "UTC";
  const avail = await getAvailability(tz);
  return formatSlotsForVoice(avail);
}

async function handleBookMeeting(params: Record<string, string>): Promise<string> {
  const { name, email, start_time, timezone = "UTC" } = params;
  if (!name || !email || !start_time) {
    return "I need your name, email, and a chosen time slot to complete the booking. Could you provide those?";
  }
  const booking = await createBooking(name, email, start_time, timezone);
  return (
    `All set! I've booked your interview. ` +
    `A calendar confirmation is on its way to ${email}. ` +
    `Booking reference: ${booking.uid ?? "confirmed"}.`
  );
}

async function dispatchTool(name: string, params: Record<string, string>): Promise<string> {
  try {
    if (name === "check_availability") return await handleCheckAvailability(params);
    if (name === "book_meeting") return await handleBookMeeting(params);
    return "I don't know how to handle that request.";
  } catch (err) {
    console.error(`[voice] tool error — ${name}:`, err);
    if (name === "check_availability") {
      return "I'm having trouble reading the calendar right now. Please try again in a moment.";
    }
    return "I ran into an issue completing the booking. Please use the chat interface to schedule.";
  }
}

// ── Webhook handler ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = (body.message ?? {}) as Record<string, unknown>;
  const msgType = message.type as string;

  // ── Current Vapi format: tool-calls ───────────────────────────────────────
  if (msgType === "tool-calls") {
    const toolCallList = (message.toolCallList ?? message.toolCalls ?? []) as Array<{
      id: string;
      function?: { name: string; arguments: string | Record<string, string> };
    }>;

    const results = await Promise.all(
      toolCallList.map(async (tc) => {
        const fnName = tc.function?.name ?? "";
        let params: Record<string, string> = {};
        try {
          const raw = tc.function?.arguments ?? {};
          params = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch {}
        const result = await dispatchTool(fnName, params);
        return { toolCallId: tc.id, result };
      })
    );

    return NextResponse.json({ results });
  }

  // ── Legacy Vapi format: function-call ─────────────────────────────────────
  if (msgType === "function-call") {
    const fnCall = (message.functionCall ?? {}) as {
      name?: string;
      parameters?: Record<string, string>;
    };
    const result = await dispatchTool(fnCall.name ?? "", fnCall.parameters ?? {});
    return NextResponse.json({ result });
  }

  // ── End of call ───────────────────────────────────────────────────────────
  if (msgType === "end-of-call-report" || msgType === "hang") {
    const reason = message.endedReason ?? message.reason ?? "unknown";
    const duration = message.durationSeconds ?? 0;
    console.log(`[Vapi] Call ended — reason=${reason}, duration=${duration}s`);
    return NextResponse.json({ status: "received" });
  }

  return NextResponse.json({ status: "ok" });
}

/**
 * Calendar Service — Cal.com v2 API integration.
 *
 * Provides:
 *   getAvailability()      — fetch open slots for the next 7 days
 *   createBooking()        — create a confirmed meeting
 *   formatSlotsForVoice()  — natural-language slot summary for voice agent
 */

const BASE = "https://api.cal.com/v2";
const TIMEOUT_MS = 12_000;

function headers(apiVersion: string) {
  return {
    Authorization: `Bearer ${process.env.CALCOM_API_KEY}`,
    "cal-api-version": apiVersion,
    "Content-Type": "application/json",
  };
}

// ── Event type ID (module-level cache) ────────────────────────────────────────

let _eventTypeId: number | null = null;

async function getEventTypeId(): Promise<number> {
  if (_eventTypeId !== null) return _eventTypeId;

  const slug = process.env.CALCOM_EVENT_SLUG || "15min";
  const res = await fetchWithTimeout(`${BASE}/event-types`, {
    headers: headers("2024-06-14"),
  });

  if (!res.ok) throw new Error(`Cal.com event-types error: ${res.status}`);
  const data = await res.json();

  // v2 response shape: {data: {eventTypeGroups: [{eventTypes: [...]}]}} or {data: [...]}
  const payload = data.data ?? {};
  const eventTypes: Array<{ id: number; slug: string }> = [];

  if (Array.isArray(payload)) {
    eventTypes.push(...payload);
  } else {
    for (const group of payload.eventTypeGroups ?? []) {
      eventTypes.push(...(group.eventTypes ?? []));
    }
    eventTypes.push(...(payload.eventTypes ?? []));
  }

  const match = eventTypes.find((et) => et.slug === slug);
  if (!match) {
    throw new Error(
      `Cal.com event type '${slug}' not found. Found: ${eventTypes.map((e) => e.slug).join(", ")}`
    );
  }

  _eventTypeId = match.id;
  return _eventTypeId;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface SlotMap {
  slots: Record<string, Array<{ time: string }>>;
}

export async function getAvailability(
  tz = "UTC",
  dateFrom?: string,
  dateTo?: string
): Promise<SlotMap> {
  const now = new Date();
  const start = dateFrom ?? now.toISOString().replace(".000", "").split(".")[0] + "Z";
  const end =
    dateTo ??
    new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split(".")[0] + "Z";

  const eventTypeId = await getEventTypeId();
  const url = new URL(`${BASE}/slots`);
  url.searchParams.set("eventTypeId", String(eventTypeId));
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  url.searchParams.set("timeZone", tz);

  const res = await fetchWithTimeout(url.toString(), {
    headers: headers("2024-09-04"),
  });
  if (!res.ok) throw new Error(`Cal.com slots error: ${res.status}`);

  const data = await res.json();
  // v2 returns {"data": {"2026-04-14": [{"start": "..."}]}}
  // Normalize to {"slots": {"2026-04-14": [{"time": "..."}]}}
  const rawSlots: Record<string, Array<{ start: string; time?: string }>> = data.data ?? {};
  const normalized: Record<string, Array<{ time: string }>> = {};
  for (const [date, times] of Object.entries(rawSlots)) {
    normalized[date] = times.map((t) => ({ time: t.start ?? t.time ?? "" }));
  }
  return { slots: normalized };
}

export interface BookingResult {
  uid: string;
  [key: string]: unknown;
}

export async function createBooking(
  name: string,
  email: string,
  startTime: string,
  tz = "UTC",
  notes = ""
): Promise<BookingResult> {
  const eventTypeId = await getEventTypeId();
  const payload = {
    eventTypeId,
    start: startTime,
    attendee: { name, email, timeZone: tz, language: "en" },
    metadata: notes ? { notes } : {},
  };

  const res = await fetchWithTimeout(`${BASE}/bookings`, {
    method: "POST",
    headers: headers("2024-08-13"),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cal.com booking error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return (data.data ?? data) as BookingResult;
}

export function formatSlotsForVoice(availability: SlotMap): string {
  const slots = availability.slots ?? {};
  const dates = Object.keys(slots);
  if (!dates.length) {
    return (
      "It looks like there are no open slots in the next 7 days. " +
      "Please try a different week or reach out via email."
    );
  }
  const lines = dates.slice(0, 3).map((date) => {
    const times = (slots[date] ?? [])
      .slice(0, 3)
      .map((t) => t.time.slice(0, 16).replace("T", " at ").replace(/-/g, "/"));
    return `${date}: ${times.join(", ")}`;
  });
  return "I have these slots open: " + lines.join("; ") + ". Which works for you?";
}

// ── Utility ────────────────────────────────────────────────────────────────────

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(id)
  );
}

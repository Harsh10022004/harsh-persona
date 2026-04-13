import { NextRequest, NextResponse } from "next/server";
import { createBooking } from "@/lib/calendar";

export async function POST(req: NextRequest) {
  try {
    const { name, email, start_time, timezone = "UTC", notes = "" } = await req.json();

    if (!name || !email || !start_time) {
      return NextResponse.json(
        { error: "name, email, and start_time are required" },
        { status: 400 }
      );
    }

    const booking = await createBooking(name, email, start_time, timezone, notes);
    return NextResponse.json(booking);
  } catch (err) {
    console.error("[/api/book]", err);
    const message = err instanceof Error ? err.message : "Booking failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

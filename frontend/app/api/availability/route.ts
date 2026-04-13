import { NextRequest, NextResponse } from "next/server";
import { getAvailability } from "@/lib/calendar";

export async function GET(req: NextRequest) {
  try {
    const tz = req.nextUrl.searchParams.get("tz") ?? "UTC";
    const data = await getAvailability(tz);
    return NextResponse.json(data);
  } catch (err) {
    console.error("[/api/availability]", err);
    return NextResponse.json({ error: "Could not fetch availability." }, { status: 502 });
  }
}

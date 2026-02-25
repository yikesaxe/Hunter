import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateDevice, getDeviceIdCookieOptions } from "@/lib/device";
import { learnFromEvent } from "@/lib/recs/learn";

const EVENT_TYPES = ["impression", "click", "save", "hide", "outbound"] as const;

export async function POST(req: NextRequest) {
  try {
    const { deviceId, isNew } = await getOrCreateDevice();
    const body = await req.json();
    const listingId = typeof body.listingId === "string" ? body.listingId.trim() : "";
    const type = EVENT_TYPES.includes(body.type) ? body.type : null;
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : undefined;

    if (!listingId || !type) {
      return NextResponse.json(
        { error: "Missing or invalid listingId or type" },
        { status: 400 }
      );
    }

    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    await prisma.event.create({
      data: {
        deviceId,
        listingId,
        type,
        metadata: metadata ?? undefined,
      },
    });

    if (type === "save" || type === "hide" || type === "click") {
      learnFromEvent(deviceId, listingId, type).catch(() => {});
    }

    const res = NextResponse.json({ ok: true });
    if (isNew) res.cookies.set("hid", deviceId, getDeviceIdCookieOptions());
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to record event" }, { status: 500 });
  }
}

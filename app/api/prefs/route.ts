import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateDevice, getDeviceIdCookieOptions } from "@/lib/device";
import { prefsSchema, type PrefsInput } from "@/lib/validation/prefs";
import { syncCrawlJobsForDevice } from "@/lib/crawlJobs";

export async function GET() {
  try {
    const { deviceId, isNew } = await getOrCreateDevice();
    const prefs = await prisma.preference.findUnique({
      where: { deviceId },
    });
    const res = NextResponse.json(prefs ? prefsToJson(prefs) : null);
    if (isNew) res.cookies.set("hid", deviceId, getDeviceIdCookieOptions());
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch prefs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { deviceId, isNew } = await getOrCreateDevice();
    const body = await req.json();
    const parsed = prefsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const p: PrefsInput = parsed.data;
    const prefs = await prisma.preference.upsert({
      where: { deviceId },
      create: {
        deviceId,
        name: p.name,
        minPrice: p.minPrice,
        maxPrice: p.maxPrice,
        beds: p.beds,
        neighborhoods: p.neighborhoods,
        amenities: p.amenities,
        moveIn: p.moveIn || "",
        notes: p.notes ?? "",
      },
      update: {
        name: p.name,
        minPrice: p.minPrice,
        maxPrice: p.maxPrice,
        beds: p.beds,
        neighborhoods: p.neighborhoods,
        amenities: p.amenities,
        moveIn: p.moveIn || "",
        notes: p.notes ?? "",
      },
    });
    // Fire-and-forget: sync CrawlJobs so the scraper scheduler picks them up
    syncCrawlJobsForDevice(deviceId).catch((e) =>
      console.error("[prefs] CrawlJob sync failed:", e)
    );

    const res = NextResponse.json(prefsToJson(prefs));
    if (isNew) res.cookies.set("hid", deviceId, getDeviceIdCookieOptions());
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to save prefs" }, { status: 500 });
  }
}

function prefsToJson(prefs: {
  id: string;
  deviceId: string;
  name: string;
  minPrice: number;
  maxPrice: number;
  beds: unknown;
  neighborhoods: unknown;
  amenities: unknown;
  moveIn: string;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: prefs.id,
    deviceId: prefs.deviceId,
    name: prefs.name,
    minPrice: prefs.minPrice,
    maxPrice: prefs.maxPrice,
    beds: ensureNumberArray(prefs.beds),
    neighborhoods: ensureStringArray(prefs.neighborhoods),
    amenities: ensureStringArray(prefs.amenities),
    moveIn: prefs.moveIn,
    notes: prefs.notes ?? "",
    createdAt: prefs.createdAt.toISOString(),
    updatedAt: prefs.updatedAt.toISOString(),
  };
}

function ensureNumberArray(v: unknown): number[] {
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) return v;
  if (typeof v === "string") try { return JSON.parse(v) as number[]; } catch { return []; }
  return [];
}

function ensureStringArray(v: unknown): string[] {
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
  if (typeof v === "string") try { return JSON.parse(v) as string[]; } catch { return []; }
  return [];
}

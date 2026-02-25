import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateDevice, getDeviceIdCookieOptions } from "@/lib/device";

export async function GET() {
  try {
    const { deviceId, isNew } = await getOrCreateDevice();

    const jobs = await prisma.crawlJob.findMany({
      where: { deviceId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        source: true,
        searchUrl: true,
        status: true,
        lastRunAt: true,
        nextRunAt: true,
        totalDiscovered: true,
        totalScraped: true,
        consecutiveFails: true,
        createdAt: true,
      },
    });

    const res = NextResponse.json(jobs);
    if (isNew) res.cookies.set("hid", deviceId, getDeviceIdCookieOptions());
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch crawl jobs" }, { status: 500 });
  }
}

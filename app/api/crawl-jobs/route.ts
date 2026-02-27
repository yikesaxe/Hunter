import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateDevice, getDeviceIdCookieOptions } from "@/lib/device";
import { getCrawlQueue } from "@/lib/queue";
import { randomUUID } from "crypto";

/** POST /api/crawl-jobs  body: { crawlJobId: string }
 *  Creates a CrawlRun and enqueues a crawl-index job immediately.
 *  The BullMQ worker must be running to process it. */
export async function POST(req: NextRequest) {
  try {
    const { deviceId, isNew } = await getOrCreateDevice();
    const { crawlJobId } = (await req.json()) as { crawlJobId: string };

    const crawlJob = await prisma.crawlJob.findFirst({
      where: { id: crawlJobId, deviceId },
    });
    if (!crawlJob) {
      return NextResponse.json({ error: "CrawlJob not found" }, { status: 404 });
    }

    const isRegistry = crawlJob.deviceId == null;
    const target = isRegistry ? 300 : 75;
    const mode = isRegistry ? "registry" : "targeted";

    const run = await prisma.crawlRun.create({
      data: {
        id: randomUUID(),
        source: crawlJob.source,
        startUrl: crawlJob.searchUrl,
        target,
        discovered: 0,
        scraped: 0,
        errors: 0,
        crawlJobId: crawlJob.id,
        mode,
      },
    });

    await getCrawlQueue().add(
      "crawl-index",
      { source: crawlJob.source, url: crawlJob.searchUrl, runId: run.id, target, crawlJobId: crawlJob.id },
      { jobId: `manual-${crawlJob.id}-${run.id}` }
    );

    // Mark the CrawlJob as running
    await prisma.crawlJob.update({
      where: { id: crawlJob.id },
      data: { status: "running", lastRunAt: new Date() },
    });

    const res = NextResponse.json({ ok: true, runId: run.id });
    if (isNew) res.cookies.set("hid", deviceId, getDeviceIdCookieOptions());
    return res;
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to trigger crawl" }, { status: 500 });
  }
}

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

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(50, parseInt(searchParams.get("limit") ?? "20", 10) || 20);

    const runs = await prisma.crawlRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    return NextResponse.json(runs);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch runs" }, { status: 500 });
  }
}

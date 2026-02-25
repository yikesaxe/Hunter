import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const rows = await prisma.listing.findMany({
      select: { source: true },
      distinct: ["source"],
      orderBy: { source: "asc" },
    });
    return NextResponse.json(rows.map((r) => r.source));
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch sources" }, { status: 500 });
  }
}

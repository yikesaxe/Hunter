import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const listing = await prisma.normalizedListing.findUnique({ where: { id } });
    if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(listing);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch listing" }, { status: 500 });
  }
}

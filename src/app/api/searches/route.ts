import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/searches — list all saved searches
 */
export async function GET() {
  const searches = await prisma.savedSearch.findMany({
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ searches });
}

/**
 * POST /api/searches — create a new saved search
 *
 * Body: {
 *   name: string,
 *   prompt: string,
 *   maxRent?: number,
 *   minBeds?: number,
 *   borough?: string,
 *   neighborhood?: string,
 *   noFeePreferred?: boolean
 * }
 */
export async function POST(request: NextRequest) {
  let body: {
    name?: string;
    prompt?: string;
    maxRent?: number;
    minBeds?: number;
    borough?: string;
    neighborhood?: string;
    noFeePreferred?: boolean;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json(
      { error: "Missing 'name' field" },
      { status: 400 }
    );
  }

  if (!body.prompt || typeof body.prompt !== "string") {
    return NextResponse.json(
      { error: "Missing 'prompt' field" },
      { status: 400 }
    );
  }

  const search = await prisma.savedSearch.create({
    data: {
      name: body.name,
      prompt: body.prompt,
      maxRent: body.maxRent ?? null,
      minBeds: body.minBeds ?? null,
      borough: body.borough ?? null,
      neighborhood: body.neighborhood ?? null,
      noFeePreferred: body.noFeePreferred ?? null,
    },
  });

  return NextResponse.json({ search }, { status: 201 });
}

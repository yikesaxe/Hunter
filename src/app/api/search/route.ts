import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// TODO: Flowglad subscription guard — check pro features access here
// TODO: Flowglad — gate advanced filters (neighborhood, net effective rent) behind pro tier

/**
 * GET /api/search
 *
 * Query params:
 *  - maxRent: number (filter canonical units with bestRentGross <= maxRent)
 *  - minBeds: number (filter bedrooms >= minBeds)
 *  - borough: string (exact match)
 *  - neighborhood: string (exact match)
 *  - noFeePreferred: "true" to sort no-fee first
 *  - page: number (default 1)
 *  - limit: number (default 20, max 100)
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const maxRent = params.get("maxRent") ? parseInt(params.get("maxRent")!) : undefined;
  const minBeds = params.get("minBeds") ? parseFloat(params.get("minBeds")!) : undefined;
  const borough = params.get("borough") || undefined;
  const neighborhood = params.get("neighborhood") || undefined;
  const noFeePreferred = params.get("noFeePreferred") === "true";
  const page = Math.max(1, parseInt(params.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(params.get("limit") || "20")));
  const skip = (page - 1) * limit;

  // Build where clause
  const where: Record<string, unknown> = {};

  if (maxRent != null) {
    where.bestRentGross = { lte: maxRent };
  }
  if (minBeds != null) {
    where.bedrooms = { gte: minBeds };
  }
  if (borough) {
    where.borough = borough;
  }
  if (neighborhood) {
    where.neighborhood = neighborhood;
  }

  // Build orderBy
  const orderBy: Array<Record<string, string>> = [];
  if (noFeePreferred) {
    orderBy.push({ brokerFee: "asc" }); // false (no fee) sorts before true
  }
  orderBy.push({ lastSeenAt: "desc" });

  const [units, total] = await Promise.all([
    prisma.canonicalUnit.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      include: {
        _count: {
          select: { unitPostings: true },
        },
        unitPostings: {
          take: 1,
          orderBy: { normalizedListing: { lastSeenAt: "desc" } },
          include: {
            normalizedListing: {
              select: { images: true },
            },
          },
        },
      },
    }),
    prisma.canonicalUnit.count({ where }),
  ]);

  const results = units.map((unit) => {
    // Get the first image from the most recent posting
    const images = (unit.unitPostings[0]?.normalizedListing?.images as string[]) || [];
    return {
      id: unit.id,
      address: unit.canonicalAddress,
      unit: unit.canonicalUnit,
      neighborhood: unit.neighborhood,
      borough: unit.borough,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      rentGross: unit.bestRentGross,
      rentNetEffective: unit.bestRentNetEffective,
      brokerFee: unit.brokerFee,
      activeState: unit.activeState,
      lastSeenAt: unit.lastSeenAt,
      sourcesCount: unit._count.unitPostings,
      imageUrl: images[0] || null,
    };
  });

  return NextResponse.json({
    results,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}

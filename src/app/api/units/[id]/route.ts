import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// TODO: Flowglad subscription guard — check pro features access here
// TODO: Flowglad — gate change log history and multi-source details behind pro tier

/**
 * GET /api/units/:id
 *
 * Returns:
 *  - Canonical unit details
 *  - All attached postings with source, url, rent, lastSeenAt
 *  - Change log entries
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const unit = await prisma.canonicalUnit.findUnique({
    where: { id },
    include: {
      unitPostings: {
        include: {
          normalizedListing: {
            select: {
              id: true,
              source: true,
              sourceUrl: true,
              title: true,
              rentGross: true,
              rentNetEffective: true,
              brokerFee: true,
              address: true,
              unit: true,
              description: true,
              images: true,
              lastSeenAt: true,
              firstSeenAt: true,
            },
          },
        },
        orderBy: { normalizedListing: { lastSeenAt: "desc" } },
      },
      changeLogs: {
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  });

  if (!unit) {
    return NextResponse.json({ error: "Unit not found" }, { status: 404 });
  }

  return NextResponse.json({
    unit: {
      id: unit.id,
      address: unit.canonicalAddress,
      unit: unit.canonicalUnit,
      neighborhood: unit.neighborhood,
      borough: unit.borough,
      lat: unit.lat,
      lng: unit.lng,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      rentGross: unit.bestRentGross,
      rentNetEffective: unit.bestRentNetEffective,
      brokerFee: unit.brokerFee,
      activeState: unit.activeState,
      lastSeenAt: unit.lastSeenAt,
      createdAt: unit.createdAt,
    },
    postings: unit.unitPostings.map((p) => ({
      id: p.normalizedListing.id,
      source: p.normalizedListing.source,
      sourceUrl: p.normalizedListing.sourceUrl,
      title: p.normalizedListing.title,
      rentGross: p.normalizedListing.rentGross,
      rentNetEffective: p.normalizedListing.rentNetEffective,
      brokerFee: p.normalizedListing.brokerFee,
      address: p.normalizedListing.address,
      unit: p.normalizedListing.unit,
      description: p.normalizedListing.description,
      images: p.normalizedListing.images,
      lastSeenAt: p.normalizedListing.lastSeenAt,
      firstSeenAt: p.normalizedListing.firstSeenAt,
      matchScore: p.matchScore,
    })),
    changeLog: unit.changeLogs.map((c) => ({
      id: c.id,
      kind: c.kind,
      payload: c.payload,
      createdAt: c.createdAt,
    })),
  });
}

import { prisma } from "@/lib/prisma";
import { normalizeAddress, geoBucket } from "@/lib/domain/normalize";

// TODO: Dedalus ADK — wrap dedupeAll() as a callable tool for the agent

/**
 * Run deduplication across all normalized listings that don't yet have
 * a canonical unit posting attached.
 */
export async function dedupeAll(): Promise<void> {
  const listings = await prisma.normalizedListing.findMany({
    where: {
      unitPostings: { none: {} },
    },
    orderBy: { lastSeenAt: "desc" },
  });

  console.log(
    `[dedupe] Found ${listings.length} normalized listings without canonical units`
  );

  for (const listing of listings) {
    await dedupeAndUpsertCanonical(listing.id);
  }

  // Also re-check all listings to update best fields on their canonical units
  const allPostings = await prisma.unitPosting.findMany({
    select: { canonicalUnitId: true },
    distinct: ["canonicalUnitId"],
  });
  for (const posting of allPostings) {
    await updateCanonicalBestFields(posting.canonicalUnitId);
  }
}

/**
 * Deduplicate a single normalized listing into a canonical unit.
 *
 * 1. Compute a fingerprint from address + unit + bedrooms + geoBucket
 * 2. Find candidate CanonicalUnits by address or geoBucket
 * 3. Score each candidate
 * 4. If best score >= 60: attach to existing, else create new
 * 5. Detect price/fee changes and log them
 */
export async function dedupeAndUpsertCanonical(
  normalizedListingId: string
): Promise<void> {
  const listing = await prisma.normalizedListing.findUnique({
    where: { id: normalizedListingId },
  });
  if (!listing) {
    console.warn(`[dedupe] Listing ${normalizedListingId} not found`);
    return;
  }

  const normAddr = listing.address
    ? normalizeAddress(listing.address)
    : null;
  const bucket = geoBucket(listing.lat, listing.lng);

  // Find candidates: canonical units that share the normalized address or geo bucket
  const candidates = await findCandidates(normAddr, bucket);

  let bestCandidate: { id: string; score: number } | null = null;

  for (const candidate of candidates) {
    const score = scoreMatch(listing, candidate, normAddr, bucket);
    if (score >= 60 && (!bestCandidate || score > bestCandidate.score)) {
      bestCandidate = { id: candidate.id, score };
    }
  }

  if (bestCandidate) {
    // Attach to existing canonical unit
    console.log(
      `[dedupe] Matched listing "${listing.title}" to canonical unit ${bestCandidate.id} (score: ${bestCandidate.score})`
    );

    await prisma.unitPosting.upsert({
      where: {
        canonicalUnitId_normalizedListingId: {
          canonicalUnitId: bestCandidate.id,
          normalizedListingId: listing.id,
        },
      },
      update: { matchScore: bestCandidate.score },
      create: {
        canonicalUnitId: bestCandidate.id,
        normalizedListingId: listing.id,
        matchScore: bestCandidate.score,
      },
    });

    // Check for changes
    await detectAndLogChanges(bestCandidate.id, listing);

    // Update canonical unit's lastSeenAt
    await prisma.canonicalUnit.update({
      where: { id: bestCandidate.id },
      data: {
        lastSeenAt: listing.lastSeenAt,
      },
    });
  } else {
    // Create new canonical unit
    console.log(
      `[dedupe] Creating new canonical unit for "${listing.title}"`
    );

    const canonical = await prisma.canonicalUnit.create({
      data: {
        canonicalAddress: normAddr,
        canonicalUnit: listing.unit,
        neighborhood: listing.neighborhood,
        borough: listing.borough,
        lat: listing.lat,
        lng: listing.lng,
        bedrooms: listing.bedrooms,
        bathrooms: listing.bathrooms,
        bestRentGross: listing.rentGross,
        bestRentNetEffective: listing.rentNetEffective,
        brokerFee: listing.brokerFee,
        activeState: "active",
        lastSeenAt: listing.lastSeenAt,
      },
    });

    await prisma.unitPosting.create({
      data: {
        canonicalUnitId: canonical.id,
        normalizedListingId: listing.id,
        matchScore: 100, // exact match — it created the canonical unit
      },
    });
  }
}

interface CandidateUnit {
  id: string;
  canonicalAddress: string | null;
  canonicalUnit: string | null;
  lat: number | null;
  lng: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
}

/**
 * Find candidate CanonicalUnits by normalized address OR geoBucket.
 */
async function findCandidates(
  normAddr: string | null,
  bucket: string | null
): Promise<CandidateUnit[]> {
  if (!normAddr && !bucket) return [];

  const conditions: Array<Record<string, unknown>> = [];

  if (normAddr) {
    conditions.push({ canonicalAddress: normAddr });
  }

  if (bucket) {
    // Parse the bucket to find nearby canonical units
    const [latStr, lngStr] = bucket.split(",");
    const bucketLat = parseFloat(latStr);
    const bucketLng = parseFloat(lngStr);

    conditions.push({
      AND: [
        { lat: { gte: bucketLat - 0.001, lte: bucketLat + 0.001 } },
        { lng: { gte: bucketLng - 0.001, lte: bucketLng + 0.001 } },
      ],
    });
  }

  return prisma.canonicalUnit.findMany({
    where: { OR: conditions },
    select: {
      id: true,
      canonicalAddress: true,
      canonicalUnit: true,
      lat: true,
      lng: true,
      bedrooms: true,
      bathrooms: true,
    },
  });
}

/**
 * Score a match between a normalized listing and a candidate canonical unit.
 *
 * Scoring:
 * - Exact normalized address match: +40
 * - Unit match: +30
 * - GeoBucket match: +20
 * - Bedrooms/baths close: +10
 */
function scoreMatch(
  listing: {
    address: string | null;
    unit: string | null;
    lat: number | null;
    lng: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
  },
  candidate: CandidateUnit,
  normAddr: string | null,
  bucket: string | null
): number {
  let score = 0;

  // Address match (+40)
  if (normAddr && candidate.canonicalAddress === normAddr) {
    score += 40;
  }

  // Unit match (+30)
  if (
    listing.unit &&
    candidate.canonicalUnit &&
    listing.unit.toLowerCase() === candidate.canonicalUnit.toLowerCase()
  ) {
    score += 30;
  }

  // GeoBucket match (+20)
  if (bucket && candidate.lat != null && candidate.lng != null) {
    const candidateBucket = geoBucket(candidate.lat, candidate.lng);
    if (candidateBucket === bucket) {
      score += 20;
    }
  }

  // Bedrooms/baths close (+10)
  if (listing.bedrooms != null && candidate.bedrooms != null) {
    if (
      Math.abs(listing.bedrooms - candidate.bedrooms) <= 0.5 &&
      (listing.bathrooms == null ||
        candidate.bathrooms == null ||
        Math.abs(listing.bathrooms - candidate.bathrooms) <= 0.5)
    ) {
      score += 10;
    }
  }

  return score;
}

/**
 * Detect price or brokerFee changes on a canonical unit and log them.
 */
async function detectAndLogChanges(
  canonicalUnitId: string,
  listing: {
    id: string;
    rentGross: number | null;
    brokerFee: boolean | null;
  }
): Promise<void> {
  const canonical = await prisma.canonicalUnit.findUnique({
    where: { id: canonicalUnitId },
  });
  if (!canonical) return;

  // Price change
  if (
    listing.rentGross != null &&
    canonical.bestRentGross != null &&
    listing.rentGross !== canonical.bestRentGross
  ) {
    console.log(
      `[dedupe] Price change on ${canonicalUnitId}: $${canonical.bestRentGross} -> $${listing.rentGross}`
    );
    await prisma.changeLog.create({
      data: {
        canonicalUnitId,
        normalizedListingId: listing.id,
        kind: "price_change",
        payload: {
          oldRentGross: canonical.bestRentGross,
          newRentGross: listing.rentGross,
        },
      },
    });
  }

  // Broker fee change
  if (
    listing.brokerFee != null &&
    canonical.brokerFee != null &&
    listing.brokerFee !== canonical.brokerFee
  ) {
    console.log(
      `[dedupe] Broker fee change on ${canonicalUnitId}: ${canonical.brokerFee} -> ${listing.brokerFee}`
    );
    await prisma.changeLog.create({
      data: {
        canonicalUnitId,
        normalizedListingId: listing.id,
        kind: "field_change",
        payload: {
          field: "brokerFee",
          oldValue: canonical.brokerFee,
          newValue: listing.brokerFee,
        },
      },
    });
  }
}

/**
 * Update a canonical unit's "best" fields from the most recently seen posting.
 */
async function updateCanonicalBestFields(
  canonicalUnitId: string
): Promise<void> {
  // Find the most recently seen listing attached to this canonical unit
  const latestPosting = await prisma.unitPosting.findFirst({
    where: { canonicalUnitId },
    orderBy: { normalizedListing: { lastSeenAt: "desc" } },
    include: { normalizedListing: true },
  });

  if (!latestPosting) return;

  const listing = latestPosting.normalizedListing;

  await prisma.canonicalUnit.update({
    where: { id: canonicalUnitId },
    data: {
      bestRentGross: listing.rentGross,
      bestRentNetEffective: listing.rentNetEffective,
      brokerFee: listing.brokerFee,
      neighborhood: listing.neighborhood,
      borough: listing.borough,
      lat: listing.lat,
      lng: listing.lng,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      lastSeenAt: listing.lastSeenAt,
    },
  });
}

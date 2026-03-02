// scraper/src/canonicalize.ts
// Cross-source deduplication: find or create a CanonicalUnit for a NormalizedListing.
//
// Strategy (descending confidence):
//   Score 3 – lat/lon within ~15m + same beds       → merge
//   Score 2 – normalized address + unit exact match → merge
//   Score 1 – normalized address + same beds/baths  → merge
//   Score 0 – no confident match                    → return null (no singleton created)

import { randomUUID } from "crypto";
import type { PrismaClient } from "../../node_modules/.prisma/client/index.js";

// ─────────────────────────────────────────────────────────────────────────────
// Address / unit normalizers
// ─────────────────────────────────────────────────────────────────────────────

const DIRECTIONALS: Record<string, string> = {
  north: "n", south: "s", east: "e", west: "w",
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
};

const STREET_TYPES: Record<string, string> = {
  street: "st", avenue: "ave", boulevard: "blvd", road: "rd",
  drive: "dr", place: "pl", court: "ct", lane: "ln", way: "wy",
};

const UNIT_PREFIX_RE = /^(apt|apartment|unit|no|number|#|suite|ste|floor|fl)[\s.#-]*/i;

export function normalizeAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.toLowerCase().trim();
  // Drop everything after first comma (city/state or unit suffix)
  s = s.replace(/,.*$/, "").trim();
  const tokens = s.split(/\s+/).map((tok) => {
    const t = tok.replace(/[^a-z0-9]/g, "");
    return DIRECTIONALS[t] ?? STREET_TYPES[t] ?? t;
  });
  return tokens.filter(Boolean).join(" ") || null;
}

export function normalizeUnit(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw.toLowerCase().replace(UNIT_PREFIX_RE, "").replace(/[^a-z0-9]/g, "").trim() || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

/** ~15 meters at NYC latitude */
const LAT_LON_DELTA = 0.00015;

export type ListingSnapshot = {
  id: string;
  source: string;
  address: string | null;
  unit: string | null;
  latitude: number | null;
  longitude: number | null;
  beds: number | null;
  baths: number | null;
  neighborhood: string | null;
  borough: string | null;
  zip: string | null;
  sqft: number | null;
  canonicalUnitId: string | null;
};

/**
 * Find or create a CanonicalUnit for a listing.
 *
 * Returns the canonicalUnitId to link to, or null if no confident match was found
 * (singleton listings are NOT given their own CanonicalUnit — they stay unlinked).
 *
 * This function is idempotent: if the listing already has a canonicalUnitId, it
 * returns it immediately without hitting the DB.
 *
 * When a new canonical is created, the matched peer listing is also linked to it
 * in the same transaction-like sequence. The caller is responsible for linking
 * the current listing and refreshing aggregate counts.
 */
export async function findOrCreateCanonical(
  prisma: PrismaClient,
  listing: ListingSnapshot
): Promise<string | null> {
  if (listing.canonicalUnitId) return listing.canonicalUnitId;

  // Fetch candidates: non-removed listings from OTHER sources
  const candidates = await prisma.normalizedListing.findMany({
    where: {
      id: { not: listing.id },
      source: { not: listing.source },
      status: { not: "removed" },
    },
    select: {
      id: true,
      source: true,
      address: true,
      unit: true,
      latitude: true,
      longitude: true,
      beds: true,
      baths: true,
      neighborhood: true,
      borough: true,
      zip: true,
      sqft: true,
      canonicalUnitId: true,
    },
  });

  const myNormAddr = normalizeAddress(listing.address);
  const myNormUnit = normalizeUnit(listing.unit);

  let bestScore = 0;
  let bestCandidate: (typeof candidates)[0] | null = null;

  for (const c of candidates) {
    let score = 0;

    // Tier 1: lat/lon proximity (~15m bounding box)
    if (
      listing.latitude != null && listing.longitude != null &&
      c.latitude != null && c.longitude != null &&
      Math.abs(listing.latitude - c.latitude) < LAT_LON_DELTA &&
      Math.abs(listing.longitude - c.longitude) < LAT_LON_DELTA
    ) {
      // Require same bed count to distinguish adjacent units in the same building
      if (listing.beds == null || c.beds == null || listing.beds === c.beds) {
        score = 3;
      } else {
        score = 1; // close but different beds — still a possible match
      }
    }

    // Tier 2: normalized address + unit
    if (score < 2 && myNormAddr) {
      const cNormAddr = normalizeAddress(c.address);
      if (cNormAddr && myNormAddr === cNormAddr) {
        const cNormUnit = normalizeUnit(c.unit);
        if (myNormUnit && cNormUnit && myNormUnit === cNormUnit) {
          score = Math.max(score, 2);
        } else if (
          listing.beds != null && c.beds != null && listing.beds === c.beds &&
          listing.baths != null && c.baths != null && listing.baths === c.baths
        ) {
          // Same address + same beds + same baths (unit field missing/inconsistent)
          score = Math.max(score, 1);
        }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestCandidate = c;
    }
  }

  if (bestScore < 1 || !bestCandidate) return null;

  // Found a confident match — use existing canonical if the peer already has one
  if (bestCandidate.canonicalUnitId) {
    return bestCandidate.canonicalUnitId;
  }

  // Neither listing has a canonical yet — create one and link the peer
  const canonicalId = randomUUID();
  await prisma.canonicalUnit.create({
    data: {
      id: canonicalId,
      address: listing.address ?? bestCandidate.address,
      unit: listing.unit ?? bestCandidate.unit,
      neighborhood: listing.neighborhood ?? bestCandidate.neighborhood,
      borough: listing.borough ?? bestCandidate.borough,
      zip: listing.zip ?? bestCandidate.zip,
      latitude: listing.latitude ?? bestCandidate.latitude,
      longitude: listing.longitude ?? bestCandidate.longitude,
      beds: listing.beds ?? bestCandidate.beds,
      baths: listing.baths ?? bestCandidate.baths,
      sqft: listing.sqft ?? bestCandidate.sqft,
    },
  });

  // Link the matched peer listing
  await prisma.normalizedListing.update({
    where: { id: bestCandidate.id },
    data: { canonicalUnitId: canonicalId },
  });

  return canonicalId;
}

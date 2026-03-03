// scraper/src/db.ts
// Core DB layer for the smart crawler.
//
// Pipeline:
//   parseListing() → upsertNormalizedListing() → [createRawListing()]
//                                               → [writeChangeLog()]
//                                               → [updateCanonicalUnitCount()]

import "dotenv/config";
import { createHash, randomUUID } from "crypto";
import { PrismaClient } from "../../node_modules/.prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import type { ListingData } from "./parseListing.js";
import { findOrCreateCanonical } from "./canonicalize.js";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
export const prisma = new PrismaClient({ adapter });

// ─────────────────────────────────────────────────────────────────────────────
// Content hash
// ─────────────────────────────────────────────────────────────────────────────

type HashableFields = {
  rentGross: number | null;
  rentNet: number | null;
  beds: number | null;
  baths: number | null;
  brokerFee: boolean | null;
  leaseTerm: string | null;
  availableFrom: Date | null;
  address: string | null;
  unit: string | null;
  neighborhood: string | null;
  description: string | null;
  amenities: string[]; // sorted before hashing
  extras: Record<string, unknown>;
};

function stableStringify(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v !== "object") return JSON.stringify(v);
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",") + "}";
}

export function computeContentHash(fields: HashableFields): string {
  const payload: HashableFields = {
    ...fields,
    amenities: [...fields.amenities].sort(),
  };
  return createHash("sha256").update(stableStringify(payload)).digest("hex");
}

/** Build a HashableFields object from a ListingData (as returned by the parser). */
function hashableFromListingData(d: ListingData): HashableFields {
  return {
    rentGross: d.price,
    rentNet: null,
    beds: d.beds,
    baths: d.baths,
    brokerFee: null,
    leaseTerm: null,
    availableFrom: null,
    address: d.address,
    unit: null,
    neighborhood: d.neighborhood,
    description: d.description ?? null,
    amenities: d.features ?? [],
    extras: d.extras ?? {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// nextScrapeAt scheduling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute when this listing should next be scraped, based on its match score.
 * High-score listings are refreshed more aggressively.
 */
export function computeNextScrapeAt(lastMatchScore: number | null): Date {
  const now = Date.now();
  const score = lastMatchScore ?? 0;

  let hours: number;
  if (score >= 70) hours = 6;       // hot match: every 6 h
  else if (score >= 40) hours = 12; // warm match: twice a day
  else if (score >= 10) hours = 24; // lukewarm: once a day
  else hours = 48;                   // cold: every 2 days

  return new Date(now + hours * 60 * 60 * 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// RawListing
// ─────────────────────────────────────────────────────────────────────────────

export async function createRawListing(
  data: ListingData,
  statusCode: number,
  normalizedListingId: string | null
): Promise<void> {
  await prisma.rawListing.create({
    data: {
      id: randomUUID(),
      source: data.source,
      sourceUrl: data.url,
      rawData: JSON.parse(JSON.stringify(data)),
      statusCode,
      normalizedListingId,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ChangeLog
// ─────────────────────────────────────────────────────────────────────────────

type ChangedFields = Record<string, { from: unknown; to: unknown }>;

export type ChangeLogTrigger = "scrape" | "refresh" | "miss-pass";

export async function writeChangeLog(
  normalizedListingId: string,
  changedFields: ChangedFields,
  trigger: ChangeLogTrigger
): Promise<void> {
  if (Object.keys(changedFields).length === 0) return;
  await prisma.changeLog.create({
    data: {
      id: randomUUID(),
      normalizedListingId,
      fields: JSON.parse(JSON.stringify(changedFields)),
      trigger,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CanonicalUnit aggregate update
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recompute and persist activePostingsCount + bestRentGross for a CanonicalUnit.
 * Called whenever a NormalizedListing linked to the unit changes status.
 */
export async function updateCanonicalUnitCount(canonicalUnitId: string): Promise<void> {
  const postings = await prisma.normalizedListing.findMany({
    where: { canonicalUnitId, status: "active" },
    select: { rentGross: true, lastSeenAt: true },
  });

  const activePostingsCount = postings.length;
  const rents = postings.map((p) => p.rentGross).filter((r): r is number => r != null);
  const bestRentGross = rents.length > 0 ? Math.min(...rents) : null;
  const lastActiveDates = postings.map((p) => p.lastSeenAt);
  const lastActiveAt = lastActiveDates.length > 0 ? new Date(Math.max(...lastActiveDates.map((d) => d.getTime()))) : null;

  await prisma.canonicalUnit.update({
    where: { id: canonicalUnitId },
    data: { activePostingsCount, bestRentGross, lastActiveAt },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// NormalizedListing upsert
// ─────────────────────────────────────────────────────────────────────────────

export type UpsertOptions = {
  /** CrawlJob that discovered this listing (for provenance). */
  discoveredByCrawlJobId?: string;
  /** HTTP status code from the scrape (stored in RawListing). */
  statusCode?: number;
  /** Whether to write a RawListing archive record. */
  storeRaw?: boolean;
};

export type UpsertResult = {
  id: string;
  isNew: boolean;
  contentChanged: boolean;
};

/**
 * Main entry point for persisting a scraped listing.
 *
 * 1. Compute contentHash to detect field changes.
 * 2. Upsert NormalizedListing (by sourceListingId or sourceUrl).
 * 3. Write ChangeLog if any tracked fields changed.
 * 4. Optionally archive raw scrape output in RawListing.
 * 5. If linked to a CanonicalUnit, refresh its aggregate counts.
 */
export async function upsertNormalizedListing(
  data: ListingData,
  opts: UpsertOptions = {}
): Promise<UpsertResult> {
  const now = new Date();
  const hashFields = hashableFromListingData(data);
  const contentHash = computeContentHash(hashFields);
  const amenities = JSON.stringify(data.features ?? []);
  const photos = JSON.stringify(data.photos ?? []);

  // Validate crawlJobId — stale IDs (e.g. after manual DB wipe) cause FK violations
  let discoveredByCrawlJobId: string | null = opts.discoveredByCrawlJobId ?? null;
  if (discoveredByCrawlJobId) {
    const jobExists = await prisma.crawlJob.findUnique({ where: { id: discoveredByCrawlJobId }, select: { id: true } });
    if (!jobExists) discoveredByCrawlJobId = null;
  }

  const scrapedExtras = data.extras && Object.keys(data.extras).length > 0
    ? data.extras as object
    : undefined;

  // Fields written on every scrape (discoveredByCrawlJobId only set at create time)
  const updateData = {
    sourceUrl: data.url,
    address: data.address,
    neighborhood: data.neighborhood,
    borough: data.borough,
    zip: null as string | null,
    latitude: data.latitude,
    longitude: data.longitude,
    rentGross: data.price,
    priceDelta: data.priceDelta,
    beds: data.beds,
    baths: data.baths,
    sqft: data.sqft,
    description: data.description,
    amenities,
    photos,
    brokerName: data.brokerName,
    scrapedExtras,
    contentHash,
    lastSeenAt: now,
    lastScrapedAt: now,
    status: "active",
    consecutiveMisses: 0,
    consecutiveFails: 0,
    nextScrapeAt: computeNextScrapeAt(null),
  };

  let existing: { id: string; contentHash: string | null; canonicalUnitId: string | null; status: string } | null = null;
  let listingId: string;
  let isNew = false;

  // ── Upsert by (source, sourceListingId) when we have a stable ID
  if (data.sourceListingId) {
    const upserted = await prisma.normalizedListing.upsert({
      where: {
        source_sourceListingId: {
          source: data.source,
          sourceListingId: data.sourceListingId,
        },
      },
      create: {
        id: randomUUID(),
        source: data.source,
        sourceListingId: data.sourceListingId,
        ...updateData,
        firstSeenAt: now,
        discoveredByCrawlJobId,
      },
      update: updateData,
      select: { id: true, contentHash: true, canonicalUnitId: true, status: true },
    });
    listingId = upserted.id;

    // Detect if this was a create by checking firstSeenAt ≈ lastSeenAt
    const fresh = await prisma.normalizedListing.findUnique({
      where: { id: listingId },
      select: { firstSeenAt: true, lastSeenAt: true, contentHash: true, canonicalUnitId: true, status: true },
    });
    isNew = fresh ? Math.abs(fresh.firstSeenAt.getTime() - fresh.lastSeenAt.getTime()) < 2000 : false;
    existing = fresh ? { id: listingId, ...fresh } : null;
  } else {
    // ── Upsert by (source, sourceUrl) as fallback
    const found = await prisma.normalizedListing.findFirst({
      where: { source: data.source, sourceUrl: data.url },
      select: { id: true, contentHash: true, canonicalUnitId: true, status: true },
    });

    if (found) {
      existing = found;
      listingId = found.id;
      await prisma.normalizedListing.update({
        where: { id: listingId },
        data: updateData,
      });
    } else {
      const created = await prisma.normalizedListing.create({
        data: {
          id: randomUUID(),
          source: data.source,
          sourceListingId: null,
          ...updateData,
          firstSeenAt: now,
          discoveredByCrawlJobId,
        },
        select: { id: true },
      });
      listingId = created.id;
      isNew = true;
    }
  }

  // ── Detect content changes and write ChangeLog
  const contentChanged = !isNew && existing?.contentHash !== contentHash;
  if (contentChanged && existing) {
    const changedFields: ChangedFields = {};

    // We can't do a granular diff without fetching old values — store the new hash as a sentinel.
    // Full field-level diff would require fetching the old row before update, which is a separate
    // optimization. For now, record that "content" changed.
    changedFields.contentHash = { from: existing.contentHash, to: contentHash };
    if (data.price != null) changedFields.rentGross = { from: null, to: data.price };

    await writeChangeLog(listingId, changedFields, "scrape");
  }

  // ── Optionally archive raw scrape output
  if (opts.storeRaw) {
    await createRawListing(data, opts.statusCode ?? 200, listingId);
  }

  // ── Update CanonicalUnit aggregate if linked
  const canonicalUnitId = existing?.canonicalUnitId ?? null;
  if (canonicalUnitId) {
    await updateCanonicalUnitCount(canonicalUnitId);
  }

  // ── Cross-source dedup: attempt to find or create a CanonicalUnit for new/unlinked listings
  if (isNew || !existing?.canonicalUnitId) {
    try {
      const fresh = await prisma.normalizedListing.findUnique({
        where: { id: listingId },
        select: {
          id: true, source: true, address: true, unit: true,
          latitude: true, longitude: true, beds: true, baths: true,
          neighborhood: true, borough: true, zip: true, sqft: true,
          canonicalUnitId: true,
        },
      });
      if (fresh && !fresh.canonicalUnitId) {
        const newCanonicalId = await findOrCreateCanonical(prisma, fresh);
        if (newCanonicalId) {
          await prisma.normalizedListing.update({
            where: { id: listingId },
            data: { canonicalUnitId: newCanonicalId },
          });
          await updateCanonicalUnitCount(newCanonicalId);
        }
      }
    } catch (err) {
      // Dedup is best-effort — never block a successful scrape
      console.warn(`[canonicalize] dedup failed for ${listingId}:`, err);
    }
  }

  return { id: listingId, isNew, contentChanged };
}

// ─────────────────────────────────────────────────────────────────────────────
// Removal
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mark a NormalizedListing as removed (404, explicit removal phrase, etc.)
 * and write a ChangeLog entry.
 */
export async function markRemoved(
  listingId: string,
  trigger: ChangeLogTrigger
): Promise<void> {
  const listing = await prisma.normalizedListing.findUnique({
    where: { id: listingId },
    select: { status: true, canonicalUnitId: true },
  });
  if (!listing || listing.status === "removed") return;

  const now = new Date();
  await prisma.normalizedListing.update({
    where: { id: listingId },
    data: { status: "removed", removedAt: now, nextScrapeAt: null },
  });

  await writeChangeLog(
    listingId,
    { status: { from: listing.status, to: "removed" } },
    trigger
  );

  if (listing.canonicalUnitId) {
    await updateCanonicalUnitCount(listing.canonicalUnitId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CrawlRun helpers (unchanged interface)
// ─────────────────────────────────────────────────────────────────────────────

export interface CrawlRunStats {
  startUrl: string;
  source: string;
  discovered: number;
  scraped: number;
  errors: number;
  target?: number;
  crawlJobId?: string;
  mode?: "targeted" | "registry";
  finishedAt?: Date;
}

export async function createCrawlRun(stats: CrawlRunStats): Promise<string> {
  const run = await prisma.crawlRun.create({
    data: {
      source: stats.source,
      startUrl: stats.startUrl,
      discovered: stats.discovered,
      scraped: stats.scraped,
      errors: stats.errors,
      target: stats.target ?? 200,
      crawlJobId: stats.crawlJobId ?? null,
      mode: stats.mode ?? "targeted",
      finishedAt: stats.finishedAt ?? undefined,
      stats: "{}",
    },
  });
  return run.id;
}

export async function finishCrawlRun(
  runId: string,
  stats: { scraped: number; errors: number; isComplete?: boolean }
): Promise<void> {
  await prisma.crawlRun.update({
    where: { id: runId },
    data: {
      finishedAt: new Date(),
      scraped: stats.scraped,
      errors: stats.errors,
      isComplete: stats.isComplete ?? false,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy compatibility shim — remove after all callers are updated
// ─────────────────────────────────────────────────────────────────────────────

/** @deprecated Use upsertNormalizedListing instead. */
export async function upsertListing(listing: ListingData): Promise<void> {
  await upsertNormalizedListing(listing, { storeRaw: false });
}

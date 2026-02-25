// scraperV2/src/db.ts
// Prisma client and helpers to persist listings and crawl runs.

import "dotenv/config";
import { createHash } from "crypto";
import { PrismaClient } from "../../node_modules/.prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import type { ListingData } from "./parseListing.js";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

/** Stable SHA-256 hash of listing fields for change detection. */
function computeContentHash(listing: ListingData): string {
  const obj = {
    title: listing.title,
    address: listing.address,
    neighborhood: listing.neighborhood,
    borough: listing.borough,
    price: listing.price,
    priceDelta: listing.priceDelta,
    beds: listing.beds,
    baths: listing.baths,
    sqft: listing.sqft,
    description: listing.description ? listing.description.slice(0, 500) : null,
    features: listing.features?.slice(0, 20) ?? [],
    sourceListingId: listing.sourceListingId,
    source: listing.source,
    url: listing.url,
  };
  const sorted = stableStringify(obj);
  return createHash("sha256").update(sorted).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return "{" + parts.join(",") + "}";
}

const now = new Date();

/**
 * Upsert a listing by (source, sourceListingId) or by url when sourceListingId is missing.
 * Sets firstSeenAt on create, lastSeenAt and lastScrapedAt on every save.
 */
export async function upsertListing(listing: ListingData): Promise<void> {
  const contentHash = computeContentHash(listing);
  const amenities = JSON.stringify(listing.features ?? []);
  const photos = JSON.stringify(listing.photos ?? []);
  const raw = JSON.stringify({
    borough: listing.borough,
    extractedBy: listing.extractedBy,
  });

  const data = {
    url: listing.url,
    canonicalUrl: listing.url,
    title: listing.title,
    address: listing.address,
    neighborhood: listing.neighborhood,
    borough: listing.borough,
    latitude: listing.latitude,
    longitude: listing.longitude,
    price: listing.price,
    priceDelta: listing.priceDelta,
    beds: listing.beds,
    baths: listing.baths,
    sqft: listing.sqft,
    description: listing.description,
    amenities,
    photos,
    contentHash,
    raw,
    lastSeenAt: now,
    lastScrapedAt: now,
    status: "active",
  };

  if (listing.sourceListingId) {
    await prisma.listing.upsert({
      where: {
        source_sourceListingId: {
          source: listing.source,
          sourceListingId: listing.sourceListingId,
        },
      },
      create: {
        source: listing.source,
        sourceListingId: listing.sourceListingId,
        ...data,
        firstSeenAt: now,
      },
      update: data,
    });
    return;
  }

  const existing = await prisma.listing.findFirst({
    where: { source: listing.source, url: listing.url },
  });
  if (existing) {
    await prisma.listing.update({
      where: { id: existing.id },
      data,
    });
    return;
  }

  await prisma.listing.create({
    data: {
      source: listing.source,
      sourceListingId: null,
      ...data,
      firstSeenAt: now,
    },
  });
}

export interface CrawlRunStats {
  startUrl: string;
  source: string;
  discovered: number;
  scraped: number;
  errors: number;
  target?: number;
  /** If set, run is stored as already finished. */
  finishedAt?: Date;
}

/**
 * Create a new crawl run. Returns the run id.
 */
export async function createCrawlRun(stats: CrawlRunStats): Promise<string> {
  const run = await prisma.crawlRun.create({
    data: {
      source: stats.source,
      startUrl: stats.startUrl,
      discovered: stats.discovered,
      scraped: stats.scraped,
      errors: stats.errors,
      target: stats.target ?? 200,
      finishedAt: stats.finishedAt ?? undefined,
      stats: "{}",
    },
  });
  return run.id;
}

/**
 * Mark a crawl run as finished and update counts.
 */
export async function finishCrawlRun(
  runId: string,
  stats: { scraped: number; errors: number }
): Promise<void> {
  await prisma.crawlRun.update({
    where: { id: runId },
    data: {
      finishedAt: new Date(),
      scraped: stats.scraped,
      errors: stats.errors,
    },
  });
}

export { prisma };

import { prisma } from "@/lib/prisma";
import { SourceAdapter } from "../adapters/SourceAdapter";

const PARSE_VERSION = "1.0.0";

/**
 * Run the full ingestion pipeline for a list of adapters.
 * For each adapter: discover -> fetch -> store raw -> parse -> upsert normalized.
 * Idempotent: re-running won't create duplicates (upsert on source+sourceUrl).
 */
export async function ingestAll(adapters: SourceAdapter[]): Promise<void> {
  for (const adapter of adapters) {
    console.log(`\n[ingest] Starting adapter: ${adapter.name}`);
    await ingestAdapter(adapter);
  }
}

async function ingestAdapter(adapter: SourceAdapter): Promise<void> {
  const discovered = await adapter.discover();
  console.log(`[ingest] ${adapter.name}: discovered ${discovered.length} listings`);

  for (const listing of discovered) {
    try {
      await ingestOne(adapter, listing.url, listing.sourceListingId);
    } catch (err) {
      console.error(
        `[ingest] ${adapter.name}: error processing ${listing.url}:`,
        err
      );
    }
  }
}

/**
 * Ingest a single listing: fetch -> raw -> parse -> normalized.
 * Returns the normalized listing ID for downstream dedupe.
 */
export async function ingestOne(
  adapter: SourceAdapter,
  url: string,
  sourceListingId?: string
): Promise<string | null> {
  const now = new Date();

  // 1. Fetch raw content
  const fetched = await adapter.fetch(url);
  console.log(`[ingest] ${adapter.name}: fetched ${url} (${fetched.httpStatus})`);

  // 2. Upsert RawListing
  const rawListing = await prisma.rawListing.upsert({
    where: {
      source_sourceUrl: {
        source: adapter.name,
        sourceUrl: url,
      },
    },
    update: {
      fetchedAt: now,
      httpStatus: fetched.httpStatus,
      rawContent: fetched.content,
      parseVersion: PARSE_VERSION,
    },
    create: {
      source: adapter.name,
      sourceUrl: url,
      sourceListingId: sourceListingId ?? null,
      fetchedAt: now,
      httpStatus: fetched.httpStatus,
      rawContent: fetched.content,
      parseVersion: PARSE_VERSION,
    },
  });

  // 3. Parse into normalized payload
  const parsed = await adapter.parse(fetched.content, {
    url,
    sourceListingId,
  });

  // 4. Store extractedJson on raw listing
  await prisma.rawListing.update({
    where: { id: rawListing.id },
    data: { extractedJson: JSON.parse(JSON.stringify(parsed)) },
  });

  // 5. Upsert NormalizedListing
  const normalized = await prisma.normalizedListing.upsert({
    where: {
      source_sourceUrl: {
        source: adapter.name,
        sourceUrl: url,
      },
    },
    update: {
      rawListingId: rawListing.id,
      title: parsed.title,
      description: parsed.description ?? null,
      address: parsed.address ?? null,
      unit: parsed.unit ?? null,
      neighborhood: parsed.neighborhood ?? null,
      borough: parsed.borough ?? null,
      lat: parsed.lat ?? null,
      lng: parsed.lng ?? null,
      rentGross: parsed.rentGross ?? null,
      rentNetEffective: parsed.rentNetEffective ?? null,
      bedrooms: parsed.bedrooms ?? null,
      bathrooms: parsed.bathrooms ?? null,
      brokerFee: parsed.brokerFee ?? null,
      leaseTermMonths: parsed.leaseTermMonths ?? null,
      moveInCostNotes: parsed.moveInCostNotes ?? null,
      petPolicy: parsed.petPolicy ?? null,
      laundry: parsed.laundry ?? null,
      elevator: parsed.elevator ?? null,
      doorman: parsed.doorman ?? null,
      images: parsed.images ?? [],
      lastSeenAt: now,
    },
    create: {
      rawListingId: rawListing.id,
      source: adapter.name,
      sourceUrl: url,
      title: parsed.title,
      description: parsed.description ?? null,
      address: parsed.address ?? null,
      unit: parsed.unit ?? null,
      neighborhood: parsed.neighborhood ?? null,
      borough: parsed.borough ?? null,
      lat: parsed.lat ?? null,
      lng: parsed.lng ?? null,
      rentGross: parsed.rentGross ?? null,
      rentNetEffective: parsed.rentNetEffective ?? null,
      bedrooms: parsed.bedrooms ?? null,
      bathrooms: parsed.bathrooms ?? null,
      brokerFee: parsed.brokerFee ?? null,
      leaseTermMonths: parsed.leaseTermMonths ?? null,
      moveInCostNotes: parsed.moveInCostNotes ?? null,
      petPolicy: parsed.petPolicy ?? null,
      laundry: parsed.laundry ?? null,
      elevator: parsed.elevator ?? null,
      doorman: parsed.doorman ?? null,
      images: parsed.images ?? [],
      firstSeenAt: now,
      lastSeenAt: now,
    },
  });

  console.log(
    `[ingest] ${adapter.name}: upserted normalized listing ${normalized.id} "${parsed.title}"`
  );
  return normalized.id;
}

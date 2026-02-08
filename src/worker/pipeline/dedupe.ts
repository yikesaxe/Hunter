import { prisma } from "@/lib/prisma";
import { normalizeAddress, geoBucket } from "@/lib/domain/normalize";

/**
 * Run deduplication across all normalized listings that don't yet have
 * a canonical unit attached.
 *
 * Stub — full implementation in Step 5.
 */
export async function dedupeAll(): Promise<void> {
  console.log("[dedupe] stub — will be implemented in step 5");
}

/**
 * Deduplicate a single normalized listing into a canonical unit.
 *
 * Stub — full implementation in Step 5.
 */
export async function dedupeAndUpsertCanonical(
  normalizedListingId: string
): Promise<void> {
  console.log(
    `[dedupe] stub — would dedupe normalized listing ${normalizedListingId}`
  );
}

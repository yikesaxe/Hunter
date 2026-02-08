/**
 * Address normalization and geo-bucketing utilities for deduplication.
 */

/**
 * Normalize a street address for comparison:
 * - Lowercase
 * - Strip common unit/apt prefixes (they're stored separately in the `unit` field)
 * - Collapse whitespace
 * - Remove trailing punctuation
 */
export function normalizeAddress(input: string): string {
  let addr = input.toLowerCase().trim();

  // Remove apartment/unit/suite designations (these go in the `unit` field)
  addr = addr.replace(
    /\b(apt|apartment|unit|suite|ste|#)\s*\.?\s*\w*$/i,
    ""
  );

  // Normalize common abbreviations
  addr = addr
    .replace(/\bstreet\b/g, "st")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\broad\b/g, "rd")
    .replace(/\bplace\b/g, "pl")
    .replace(/\blast\b/g, "e")
    .replace(/\bwest\b/g, "w")
    .replace(/\bnorth\b/g, "n")
    .replace(/\bsouth\b/g, "s");

  // Collapse whitespace and trim
  addr = addr.replace(/\s+/g, " ").trim();

  // Remove trailing commas or periods
  addr = addr.replace(/[.,]+$/, "").trim();

  return addr;
}

/**
 * Round lat/lng to ~100m precision for geographic bucketing.
 * At NYC's latitude (~40.7), 0.001 degrees ≈ 111m lat, ~85m lng.
 * We round to 3 decimal places.
 */
export function geoBucket(
  lat: number | null | undefined,
  lng: number | null | undefined
): string | null {
  if (lat == null || lng == null) return null;
  const bucketLat = Math.round(lat * 1000) / 1000;
  const bucketLng = Math.round(lng * 1000) / 1000;
  return `${bucketLat.toFixed(3)},${bucketLng.toFixed(3)}`;
}

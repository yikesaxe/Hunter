// scraper/src/sites/leasebreak.ts
// Build LeaseBreak search URLs from preference parameters.
//
// LeaseBreak URL structure:
//   https://leasebreak.com/listings?min_rent={min}&max_rent={max}&bedrooms={n}&neighborhood={name}
//
// Notes:
//   - Neighborhoods are passed as free-text (?neighborhood=Chelsea).
//   - Multiple beds: one URL per bed count (LeaseBreak doesn't support arrays).
//   - LeaseBreak is a no-fee platform by definition; no no-fee toggle needed.

import type { SearchParams } from "./index.js";

const BASE = "https://leasebreak.com/listings";

/**
 * Returns a single broad LeaseBreak search URL filtered by price range only.
 * Neighborhood and bed filtering happens at recommendation time, not at crawl time,
 * to avoid a combinatorial explosion of CrawlJobs.
 */
export function buildLeaseBreakUrl(params: SearchParams): string[] {
  const { minPrice, maxPrice } = params;

  const qs = new URLSearchParams();
  if (minPrice != null) qs.set("min_rent", String(minPrice));
  if (maxPrice != null) qs.set("max_rent", String(maxPrice));

  return [`${BASE}?${qs.toString()}`];
}

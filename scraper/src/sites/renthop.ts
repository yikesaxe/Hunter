// scraper/src/sites/renthop.ts
// Build RentHop search URLs from preference parameters.
//
// RentHop URL structure:
//   https://www.renthop.com/search/nyc?min_price={min}&max_price={max}&bedrooms={n}&...
//
// Notes:
//   - Neighborhood filter: &neighborhoods[]={id} (numeric IDs) — we use name-based
//     search instead since IDs are not stable. Neighborhood names are passed as
//     &q={name} free-text query, one URL per neighborhood.
//   - Multiple beds: one URL per bedroom count (RentHop only accepts a single bedrooms= value).
//   - No-fee: &no_fee=1

import type { SearchParams } from "./index.js";

const BASE = "https://www.renthop.com/search/nyc";

/**
 * Returns a single broad RentHop NYC search URL filtered by price range only.
 * Neighborhood and bed filtering happens at recommendation time, not at crawl time,
 * to avoid a combinatorial explosion of CrawlJobs.
 */
export function buildRentHopUrl(params: SearchParams): string[] {
  const { minPrice, maxPrice, noFee } = params;

  const qs = new URLSearchParams();
  if (minPrice != null) qs.set("min_price", String(minPrice));
  if (maxPrice != null) qs.set("max_price", String(maxPrice));
  if (noFee) qs.set("no_fee", "1");

  return [`${BASE}?${qs.toString()}`];
}

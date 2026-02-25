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
 * Returns one URL per (neighborhood × bed count) combination, since RentHop
 * doesn't support multi-neighborhood or multi-bed queries in a single URL.
 * Falls back to a single broad NYC search when no neighborhoods/beds are given.
 */
export function buildRentHopUrl(params: SearchParams): string[] {
  const { neighborhoods = [], minPrice, maxPrice, beds, noFee } = params;

  const effectiveNeighborhoods = neighborhoods.length > 0 ? neighborhoods : [null];
  const effectiveBeds = beds && beds.length > 0 ? beds : [null];

  const urls: string[] = [];

  for (const neighborhood of effectiveNeighborhoods) {
    for (const bed of effectiveBeds) {
      const qs = new URLSearchParams();

      if (minPrice != null) qs.set("min_price", String(minPrice));
      if (maxPrice != null) qs.set("max_price", String(maxPrice));
      if (bed != null) qs.set("bedrooms", String(bed));
      if (neighborhood != null) qs.set("q", neighborhood);
      if (noFee) qs.set("no_fee", "1");

      urls.push(`${BASE}?${qs.toString()}`);
    }
  }

  return urls;
}

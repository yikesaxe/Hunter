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
 * Returns one URL per (neighborhood × bed count) combination.
 * Falls back to a single broad search when no neighborhoods/beds are given.
 */
export function buildLeaseBreakUrl(params: SearchParams): string[] {
  const { neighborhoods = [], minPrice, maxPrice, beds } = params;

  const effectiveNeighborhoods = neighborhoods.length > 0 ? neighborhoods : [null];
  const effectiveBeds = beds && beds.length > 0 ? beds : [null];

  const urls: string[] = [];

  for (const neighborhood of effectiveNeighborhoods) {
    for (const bed of effectiveBeds) {
      const qs = new URLSearchParams();

      if (minPrice != null) qs.set("min_rent", String(minPrice));
      if (maxPrice != null) qs.set("max_rent", String(maxPrice));
      if (bed != null) qs.set("bedrooms", String(bed));
      if (neighborhood != null) qs.set("neighborhood", neighborhood);

      urls.push(`${BASE}?${qs.toString()}`);
    }
  }

  return urls;
}

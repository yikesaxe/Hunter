// scraper/src/sites/zillow.ts
// Build Zillow rental search URLs from preference parameters.
//
// Zillow encodes most search state in a base64 JSON searchQueryState blob.
// However, a simpler URL form also works for basic searches:
//   https://www.zillow.com/new-york-ny/rentals/?searchQueryState={JSON}
//
// The JSON structure:
// {
//   "pagination": {},
//   "isMapVisible": false,
//   "filterState": {
//     "fr": { "value": true },      // for-rent
//     "fsba": { "value": false },   // exclude for-sale by agent
//     "nc": { "value": false },
//     "mp": { "max": N },           // max monthly payment
//     "price": { "min": N, "max": N },
//     "beds": { "min": N, "max": N },
//     ...
//   }
// }

import type { SearchParams } from "./index.js";

const BASE = "https://www.zillow.com/new-york-ny/rentals/";

/**
 * Returns a single Zillow search URL.
 * Zillow supports multi-bed ranges but not multi-neighborhood in one URL;
 * we map beds to min/max (using the broadest range) and ignore neighborhoods
 * (Zillow uses map-based geo search).
 */
export function buildZillowUrl(params: SearchParams): string[] {
  const { minPrice, maxPrice, beds } = params;

  const filterState: Record<string, unknown> = {
    fr: { value: true },
    fsba: { value: false },
    fsbo: { value: false },
    nc: { value: false },
    cmsn: { value: false },
    auc: { value: false },
    fore: { value: false },
  };

  if (minPrice != null || maxPrice != null) {
    const priceFilter: Record<string, number> = {};
    if (minPrice != null) priceFilter.min = minPrice;
    if (maxPrice != null) priceFilter.max = maxPrice;
    filterState.mp = priceFilter;
    filterState.price = priceFilter;
  }

  if (beds && beds.length > 0) {
    const minBeds = Math.min(...beds);
    const maxBeds = Math.max(...beds);
    filterState.beds = { min: minBeds, max: maxBeds };
  }

  const searchQueryState = JSON.stringify({
    pagination: {},
    isMapVisible: false,
    filterState,
  });

  const qs = new URLSearchParams({ searchQueryState });
  return [`${BASE}?${qs.toString()}`];
}

// scraper/src/sites/streeteasy.ts
// Build StreetEasy rental search URLs from preference parameters.
//
// StreetEasy URL structure (for-rent):
//   https://streeteasy.com/for-rent/{area}?price={min}%2C{max}&beds={n}&...
//
// Notes:
//   - Multiple neighborhoods in a single URL: comma-joined in the path segment
//     e.g. /for-rent/chelsea,west-village
//   - No-fee filter: &listed_by=1 (owner only) — approximation; SE has no exact no-fee toggle
//   - Beds: 0=Studio, 1=1BR, 2=2BR … passed as ?beds=0,1,2

import type { SearchParams } from "./index.js";

const BASE = "https://streeteasy.com";

/** Normalize a neighborhood name to StreetEasy's slug format (lowercase, hyphens). */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Returns one URL covering all provided neighborhoods (comma-joined path).
 * Falls back to /manhattan when no neighborhoods are specified.
 */
export function buildStreetEasyUrl(params: SearchParams): string[] {
  const { neighborhoods = [], minPrice, maxPrice, beds, noFee } = params;

  const areaSlug =
    neighborhoods.length > 0
      ? neighborhoods.map(toSlug).join(",")
      : "manhattan";

  const qs = new URLSearchParams();

  if (minPrice != null || maxPrice != null) {
    const lo = minPrice ?? 0;
    const hi = maxPrice ?? 50000;
    qs.set("price", `${lo}%2C${hi}`);
  }

  if (beds && beds.length > 0) {
    qs.set("beds", beds.join(","));
  }

  if (noFee) {
    // StreetEasy "no fee" checkbox maps to listed_by=1 (owner) — best available filter
    qs.set("listed_by", "1");
  }

  const query = qs.toString();
  const url = `${BASE}/for-rent/${areaSlug}${query ? `?${query}` : ""}`;
  return [url];
}

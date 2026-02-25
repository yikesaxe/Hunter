// scraper/src/sites/index.ts
// Registry of all supported sources with URL builder functions.

import { buildStreetEasyUrl } from "./streeteasy.js";
import { buildRentHopUrl } from "./renthop.js";
import { buildZillowUrl } from "./zillow.js";
import { buildLeaseBreakUrl } from "./leasebreak.js";

export { buildStreetEasyUrl, buildRentHopUrl, buildZillowUrl, buildLeaseBreakUrl };

export type SearchParams = {
  neighborhoods?: string[];
  minPrice?: number;
  maxPrice?: number;
  /** 0 = studio, 1 = 1BR, 2 = 2BR, etc. */
  beds?: number[];
  noFee?: boolean;
};

/** All sources the crawler knows about. */
export const ALL_SOURCES = ["streeteasy", "renthop", "zillow", "leasebreak"] as const;
export type Source = (typeof ALL_SOURCES)[number];

const builders: Record<Source, (params: SearchParams) => string[]> = {
  streeteasy: buildStreetEasyUrl,
  renthop: buildRentHopUrl,
  zillow: buildZillowUrl,
  leasebreak: buildLeaseBreakUrl,
};

/**
 * Build one or more search index URLs for a given source + preference set.
 * May return multiple URLs (e.g. one per neighborhood for sources that don't
 * support multi-neighborhood queries).
 */
export function buildSearchUrls(source: Source, params: SearchParams): string[] {
  return builders[source](params);
}

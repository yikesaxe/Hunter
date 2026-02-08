/**
 * StreetEasy automated adapter — uses Firecrawl API to bypass bot detection.
 *
 * Tracks a fixed set of ~50 known StreetEasy listing URLs.
 * Each run fetches every listing via Firecrawl, parses it, and upserts.
 * This gives consistent tracking of prices, availability, and changes over time.
 *
 * To refresh the seed list, run: npm run worker -- --source streeteasy --refresh
 */
import {
  SourceAdapter,
  DiscoveredListing,
  FetchResult,
} from "./SourceAdapter";
import { NormalizedListingInput } from "@/lib/domain/types";
import { fetchViaFirecrawl, FirecrawlMetadata } from "../http/firecrawl";
import { parseStreetEasyHtml } from "./streeteasyImport";

/**
 * Fixed seed list of StreetEasy listing URLs to track.
 * These are real listings discovered via Firecrawl on Feb 8, 2026.
 * Each run will re-fetch and update these listings.
 */
const SEED_LISTINGS: string[] = [
  "https://streeteasy.com/building/the-oskar-luxury-apartments/ph7",
  "https://streeteasy.com/building/one-manhattan-square/62j",
  "https://streeteasy.com/building/38-sixth/1704",
  "https://streeteasy.com/building/923-5-avenue-new_york/4a",
  "https://streeteasy.com/building/villas-iii/6b",
  "https://streeteasy.com/building/canvas-albee-square/7f",
  "https://streeteasy.com/building/101-east-2nd-street-new_york/3c",
  "https://streeteasy.com/building/820-franklin-avenue-brooklyn/5e",
  "https://streeteasy.com/building/west-54th/1212",
  "https://streeteasy.com/building/pacific-house/510",
  "https://streeteasy.com/building/1025-park-avenue/2b",
  "https://streeteasy.com/building/cd280-280-east-2nd-street-new_york/211",
  "https://streeteasy.com/building/25_31-35-street-astoria/1",
  "https://streeteasy.com/building/321-west-47-street-new_york/1aa",
  "https://streeteasy.com/building/the-highland/h719",
  "https://streeteasy.com/building/475-clermont/a",
  "https://streeteasy.com/building/219-frost-street-brooklyn/3",
  "https://streeteasy.com/building/the-dean/514",
  "https://streeteasy.com/building/1025-park-avenue/2c",
  "https://streeteasy.com/building/atelier-condominium/20k",
  "https://streeteasy.com/building/100-11-avenue-new_york/16a",
  "https://streeteasy.com/building/101-varet-street-brooklyn/3d",
  "https://streeteasy.com/building/100-11-avenue-new_york/11b",
  "https://streeteasy.com/building/caesura-280-ashland-place-brooklyn/1006",
  "https://streeteasy.com/building/675-west-59th-street-new_york/304",
  "https://streeteasy.com/building/one-manhattan-square/ph80c",
  "https://streeteasy.com/building/348-west-47-street-new_york/4c",
  "https://streeteasy.com/building/443-west-50-street-new_york/1w",
  "https://streeteasy.com/building/mercedes-house/2022",
  "https://streeteasy.com/building/465-pacific-street-brooklyn/4d",
  "https://streeteasy.com/building/one-manhattan-square/49l",
  "https://streeteasy.com/building/20-pine-the-collection/907908",
  "https://streeteasy.com/building/vantage-238/7a",
  "https://streeteasy.com/building/429-broome-street-new_york/flagshipcondo",
  "https://streeteasy.com/building/brooklyn-point/23j",
  "https://streeteasy.com/building/one-manhattan-square/36c",
  "https://streeteasy.com/building/one-manhattan-square/29a",
  "https://streeteasy.com/building/waverly-brooklyn/ph3",
  "https://streeteasy.com/building/brooklyn-point/phe",
  "https://streeteasy.com/building/200-east-16-street-new_york/11gh",
  "https://streeteasy.com/building/58-west-9-street-new_york/house",
  "https://streeteasy.com/building/the-volney/5a",
  "https://streeteasy.com/building/935-brooklyn-avenue-brooklyn/three",
  "https://streeteasy.com/building/the-pearson-court-square/5c",
  "https://streeteasy.com/building/hunters-landing-lic/ph9",
  "https://streeteasy.com/building/993-park-avenue-new_york/7n",
  "https://streeteasy.com/building/784-park-avenue-new_york/5f",
  "https://streeteasy.com/building/195-meserole-street-brooklyn/3r",
  "https://streeteasy.com/building/75-west-end-avenue-new_york/s5j",
  "https://streeteasy.com/building/350-east-52nd-street-new_york/2g",
];

const FIRECRAWL_MAP_URL = "https://api.firecrawl.dev/v1/map";
const LISTING_URL_PATTERN = /\/building\/[a-z0-9_-]+\/[a-z0-9_-]+$/i;

/** Cache Firecrawl metadata alongside fetched HTML for use in parse() */
const metadataCache = new Map<string, FirecrawlMetadata>();

/**
 * Discover new listing URLs via Firecrawl map (used with --refresh flag).
 */
async function discoverNewListings(apiKey: string): Promise<DiscoveredListing[]> {
  console.log("[streeteasy] Refreshing listing seed via Firecrawl map...");

  const response = await fetch(FIRECRAWL_MAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url: "https://streeteasy.com",
      search: "building rental apartment listing for rent",
      limit: 500,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Firecrawl map error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = await response.json();
  const results: DiscoveredListing[] = [];
  const seen = new Set<string>();

  for (const link of (data.links || []) as string[]) {
    if (LISTING_URL_PATTERN.test(link) && !seen.has(link)) {
      seen.add(link);
      const match = link.match(/\/building\/(.+)$/);
      results.push({
        url: link,
        sourceListingId: match ? match[1] : link,
      });
    }
  }

  console.log(`[streeteasy] Found ${results.length} listing URLs from map`);
  return results;
}

export const streeteasyAdapter: SourceAdapter = {
  name: "streeteasy",

  async discover(): Promise<DiscoveredListing[]> {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error("FIRECRAWL_API_KEY not set.");
    }

    // Check if --refresh flag is set
    const refresh = process.argv.includes("--refresh");

    if (refresh) {
      // Discover fresh listings from Firecrawl map
      const fresh = await discoverNewListings(apiKey);
      // Merge with seed list (deduped)
      const all = new Set([
        ...SEED_LISTINGS,
        ...fresh.map((l) => l.url),
      ]);
      console.log(
        `[streeteasy] Merged: ${SEED_LISTINGS.length} seed + ${fresh.length} fresh = ${all.size} total`
      );
      return [...all].map((url) => ({
        url,
        sourceListingId: url.match(/\/building\/(.+)$/)?.[1] || url,
      }));
    }

    // Default: use the fixed seed list
    console.log(
      `[streeteasy] Using ${SEED_LISTINGS.length} fixed seed listings (use --refresh to discover new ones)`
    );
    return SEED_LISTINGS.map((url) => ({
      url,
      sourceListingId: url.match(/\/building\/(.+)$/)?.[1] || url,
    }));
  },

  async fetch(url: string): Promise<FetchResult> {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error("FIRECRAWL_API_KEY not set.");
    }

    const result = await fetchViaFirecrawl(url, apiKey);
    metadataCache.set(url, result.metadata);

    return {
      httpStatus: result.html ? 200 : 404,
      content: result.html,
      finalUrl: url,
    };
  },

  async parse(
    content: string,
    meta: { url: string; sourceListingId?: string }
  ): Promise<NormalizedListingInput & { title: string }> {
    const firecrawlMeta = metadataCache.get(meta.url);
    metadataCache.delete(meta.url);
    return parseStreetEasyHtml(content, meta, firecrawlMeta);
  },
};

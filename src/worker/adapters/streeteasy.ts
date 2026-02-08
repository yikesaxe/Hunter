/**
 * StreetEasy automated adapter — uses Firecrawl API to bypass bot detection.
 *
 * discover() -> Firecrawl /map endpoint to find listing URLs
 * fetch()    -> Firecrawl /scrape to get detail page HTML
 * parse()    -> extract listing data from HTML + Firecrawl metadata
 */
import {
  SourceAdapter,
  DiscoveredListing,
  FetchResult,
} from "./SourceAdapter";
import { NormalizedListingInput } from "@/lib/domain/types";
import { fetchViaFirecrawl, FirecrawlMetadata } from "../http/firecrawl";
import { parseStreetEasyHtml } from "./streeteasyImport";

const FIRECRAWL_MAP_URL = "https://api.firecrawl.dev/v1/map";

/**
 * Listing URL pattern — only /building/slug/unit (has a unit = individual listing).
 * /building/slug alone is a building page, not a specific listing.
 */
const LISTING_URL_PATTERN = /\/building\/[a-z0-9_-]+\/[a-z0-9_-]+$/i;

/** Cache Firecrawl metadata alongside fetched HTML for use in parse() */
const metadataCache = new Map<string, FirecrawlMetadata>();

export const streeteasyAdapter: SourceAdapter = {
  name: "streeteasy",

  /**
   * Discover listing URLs using Firecrawl's /map endpoint.
   * This finds URLs across the site without needing to render heavy search pages.
   */
  async discover(): Promise<DiscoveredListing[]> {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error(
        "FIRECRAWL_API_KEY not set. Add it to .env to use StreetEasy automated scraping."
      );
    }

    console.log("[streeteasy] Discovering listings via Firecrawl map endpoint...");

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
      throw new Error(`[streeteasy] Firecrawl map error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();

    if (!data.success || !data.links) {
      throw new Error("[streeteasy] Firecrawl map returned no links");
    }

    // Filter for individual listing URLs (building/slug/unit pattern)
    const results: DiscoveredListing[] = [];
    const seen = new Set<string>();

    for (const link of data.links as string[]) {
      if (LISTING_URL_PATTERN.test(link) && !seen.has(link)) {
        seen.add(link);
        // Extract listing ID from URL path
        const match = link.match(/\/building\/(.+)$/);
        const sourceListingId = match ? match[1] : link;

        results.push({
          url: link,
          sourceListingId,
        });
      }
    }

    console.log(
      `[streeteasy] Discovered ${results.length} individual listing URLs from ${data.links.length} total links`
    );
    return results;
  },

  async fetch(url: string): Promise<FetchResult> {
    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) {
      throw new Error("FIRECRAWL_API_KEY not set.");
    }

    const result = await fetchViaFirecrawl(url, apiKey);

    // Cache the metadata so parse() can use it
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
    // Retrieve cached Firecrawl metadata
    const firecrawlMeta = metadataCache.get(meta.url);
    metadataCache.delete(meta.url); // clean up

    return parseStreetEasyHtml(content, meta, firecrawlMeta);
  },
};

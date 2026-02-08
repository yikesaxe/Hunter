/**
 * RentHop adapter — uses Firecrawl for discovery + fetching.
 * RentHop is NYC-focused so listings are highly relevant.
 */
import {
  SourceAdapter,
  DiscoveredListing,
  FetchResult,
} from "./SourceAdapter";
import { NormalizedListingInput } from "@/lib/domain/types";
import { fetchViaFirecrawl, FirecrawlMetadata } from "../http/firecrawl";
import { mapViaFirecrawl } from "../http/firecrawlMap";
import { loadHtml } from "../html/cheerio";
import { parseMoney, parseNumber } from "../html/parse";

const LISTING_PATTERN = /\/listings\/[a-z0-9-]+\/[a-z0-9-]+\/\d+/i;

const metadataCache = new Map<string, FirecrawlMetadata>();

/**
 * Normalize borough from RentHop's neighborhood text.
 * e.g. "East Williamsburg, Williamsburg, Northern Brooklyn, Brooklyn, 11206"
 */
function extractBoroughFromLocation(text: string): {
  neighborhood: string | null;
  borough: string | null;
} {
  const parts = text.split(",").map((s) => s.trim());
  const boroughs = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];
  let borough: string | null = null;
  let neighborhood: string | null = null;

  for (const part of parts) {
    for (const b of boroughs) {
      if (part.toLowerCase().includes(b.toLowerCase())) {
        borough = b;
        break;
      }
    }
  }

  // First part is usually the most specific neighborhood
  if (parts.length > 0 && parts[0].length < 40) {
    neighborhood = parts[0];
  }

  return { neighborhood, borough };
}

export const renthopAdapter: SourceAdapter = {
  name: "renthop",

  async discover(): Promise<DiscoveredListing[]> {
    const mapResult = await mapViaFirecrawl({
      url: "https://www.renthop.com",
      search: "listing apartment rental NYC bedroom",
      source: "renthop",
      limit: 500,
    });

    // Also do a broader search
    const mapResult2 = await mapViaFirecrawl({
      url: "https://www.renthop.com/apartments-for-rent/new-york-ny",
      search: "listings apartment for rent",
      limit: 500,
    });

    // Merge and dedupe
    const seen = new Set<string>();
    const results: DiscoveredListing[] = [];

    for (const link of [...mapResult.allLinks, ...mapResult2.allLinks]) {
      if (LISTING_PATTERN.test(link) && !seen.has(link)) {
        seen.add(link);
        const idMatch = link.match(/\/(\d+)$/);
        results.push({
          url: link,
          sourceListingId: idMatch ? idMatch[1] : undefined,
        });
      }
    }

    console.log(`[renthop] Discovered ${results.length} listing URLs`);
    return results;
  },

  async fetch(url: string): Promise<FetchResult> {
    const result = await fetchViaFirecrawl(url);
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
    const $ = loadHtml(content);
    const fcMeta = metadataCache.get(meta.url);
    metadataCache.delete(meta.url);

    // --- Address / Title ---
    const h1 = $("h1").first().text().trim().replace(/\s+/g, " ");
    const ogTitle = typeof fcMeta?.["og:title"] === "string" ? fcMeta["og:title"] : "";

    // H1 like "260 Moore Street #208"
    let address = h1.replace(/#\w+$/, "").trim() || "Unknown";
    let unit: string | null = null;
    const unitMatch = h1.match(/#(\w+)/);
    if (unitMatch) unit = unitMatch[1];

    const title = h1 || ogTitle.split("—")[0].trim() || address;

    // --- Neighborhood / Borough ---
    let neighborhood: string | null = null;
    let borough: string | null = null;

    // RentHop has a div with full location chain
    $("div").each((_, el) => {
      const text = $(el).text().trim();
      if (
        text.includes("Brooklyn,") || text.includes("Manhattan,") ||
        text.includes("Queens,") || text.includes("Bronx,")
      ) {
        if (text.length < 120 && $(el).children().length === 0) {
          const loc = extractBoroughFromLocation(text);
          if (loc.borough) borough = loc.borough;
          if (loc.neighborhood) neighborhood = loc.neighborhood;
        }
      }
    });

    // Fallback from og:title like "260 Moore Street, Brooklyn, NY 11206"
    if (!borough && ogTitle) {
      for (const b of ["Manhattan", "Brooklyn", "Queens", "Bronx"]) {
        if (ogTitle.includes(b)) { borough = b; break; }
      }
    }

    // --- Rent ---
    const priceEl = $(".listing-details-price").first().text().trim();
    let rentGross = parseMoney(priceEl);

    // Fallback from description meta
    if (!rentGross && fcMeta?.description) {
      const descMatch = String(fcMeta.description).match(/\$\s*([\d,]+)/);
      if (descMatch) rentGross = parseMoney(`$${descMatch[1]}`);
    }

    // --- Bedrooms / Bathrooms ---
    let bedrooms: number | null = null;
    let bathrooms: number | null = null;

    $("div").each((_, el) => {
      const text = $(el).text().trim().toLowerCase();
      if ($(el).children().length === 0 && text.length < 20) {
        if (/^\d+\s*bed/.test(text)) bedrooms = parseNumber(text.match(/(\d+)/)?.[1] ?? null);
        if (/^\d+\.?\d*\s*bath/.test(text)) bathrooms = parseNumber(text.match(/([\d.]+)/)?.[1] ?? null);
        if (text === "studio") bedrooms = 0;
      }
    });

    // Fallback from broader text
    if (bedrooms === null) {
      const bedMatch = $.text().match(/(\d+)\s*bed/i);
      if (bedMatch) bedrooms = parseNumber(bedMatch[1]);
    }
    if (bathrooms === null) {
      const bathMatch = $.text().match(/([\d.]+)\s*bath/i);
      if (bathMatch) bathrooms = parseNumber(bathMatch[1]);
    }

    // --- Broker Fee ---
    let brokerFee: boolean | null = null;
    const pageText = $.text().toLowerCase();
    if (pageText.includes("no fee")) brokerFee = false;
    else if (pageText.includes("broker fee")) brokerFee = true;

    // --- Description ---
    let description: string | null = null;
    const descMatch = String(fcMeta?.description || "");
    if (descMatch.length > 20) description = descMatch;

    // --- Images ---
    const images: string[] = [];
    const ogImg = fcMeta?.["og:image"];
    if (Array.isArray(ogImg)) images.push(...ogImg.filter((u) => !u.includes("icon")));
    else if (typeof ogImg === "string" && !ogImg.includes("icon")) images.push(ogImg);

    $("img").each((_, el) => {
      const src = $(el).attr("src") || "";
      if (src.includes("renthop") && src.includes("listing") && !images.includes(src)) {
        images.push(src);
      }
    });

    return {
      source: "renthop",
      sourceUrl: meta.url,
      title,
      description,
      address,
      unit,
      neighborhood,
      borough,
      lat: null,
      lng: null,
      rentGross,
      rentNetEffective: null,
      bedrooms,
      bathrooms,
      brokerFee,
      leaseTermMonths: null,
      moveInCostNotes: null,
      petPolicy: null,
      laundry: null,
      elevator: null,
      doorman: null,
      images,
    };
  },
};

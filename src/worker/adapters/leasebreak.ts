import {
  SourceAdapter,
  DiscoveredListing,
  FetchResult,
} from "./SourceAdapter";
import { NormalizedListingInput } from "@/lib/domain/types";
import { fetchWithPolicy } from "../http/fetchWithPolicy";
import { mapViaFirecrawl } from "../http/firecrawlMap";
import { loadHtml } from "../html/cheerio";
import {
  parseText,
  parseAllText,
  parseMoney,
  parseDateFromText,
  parseNumber,
  parseAllAttr,
} from "../html/parse";

const BASE_URL = "https://www.leasebreak.com";

/**
 * Seed search result pages to discover listings from.
 * Each is a neighborhood search URL on Leasebreak.
 */
const SEED_URLS = [
  `${BASE_URL}/sublets/Brooklyn/Williamsburg`,
  `${BASE_URL}/sublets/Manhattan/East-Village`,
  `${BASE_URL}/sublets/Manhattan/Upper-West-Side`,
  `${BASE_URL}/sublets/Brooklyn/Park-Slope`,
  `${BASE_URL}/sublets/Manhattan/Midtown`,
  `${BASE_URL}/sublets/Queens/Astoria`,
];

const DETAIL_URL_PATTERN = /\/short-term-rental-details\/(\d+)\/([^"]+)/;

/**
 * Capitalize first letter of each word.
 */
function titleCase(str: string): string {
  return str
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Normalize borough name to expected casing.
 */
function normalizeBoroughName(raw: string): string {
  const map: Record<string, string> = {
    manhattan: "Manhattan",
    brooklyn: "Brooklyn",
    queens: "Queens",
    bronx: "Bronx",
    "staten island": "Staten Island",
  };
  return map[raw.toLowerCase().trim()] ?? titleCase(raw);
}

/**
 * Parse lease term text like "8 months" or "1 month" into integer months.
 */
function parseLeaseTermMonths(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/(\d+)\s*month/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Discover listings by fetching seed search pages directly (no Firecrawl needed).
 */
async function discoverViaSeedPages(): Promise<DiscoveredListing[]> {
  const seen = new Set<string>();
  const results: DiscoveredListing[] = [];

  for (const seedUrl of SEED_URLS) {
    try {
      console.log(`[leasebreak] Discovering from ${seedUrl}`);
      const res = await fetchWithPolicy(seedUrl);

      if (res.httpStatus !== 200) {
        console.warn(
          `[leasebreak] Seed page ${seedUrl} returned ${res.httpStatus}`
        );
        continue;
      }

      const matches = res.content.matchAll(
        /href="(\/short-term-rental-details\/(\d+)\/[^"]+)"/g
      );

      for (const match of matches) {
        const path = match[1];
        const listingId = match[2];
        const fullUrl = `${BASE_URL}${path}`;

        if (!seen.has(fullUrl)) {
          seen.add(fullUrl);
          results.push({
            url: fullUrl,
            sourceListingId: listingId,
          });
        }
      }
    } catch (err) {
      console.error(`[leasebreak] Error discovering from ${seedUrl}:`, err);
    }
  }

  console.log(
    `[leasebreak] Discovered ${results.length} unique detail URLs from ${SEED_URLS.length} seed pages`
  );
  return results;
}

/**
 * Discover listings via Firecrawl /map endpoint — finds URLs across the site.
 */
async function discoverViaFirecrawl(): Promise<DiscoveredListing[]> {
  console.log("[leasebreak] Discovering via Firecrawl map...");

  const mapResult = await mapViaFirecrawl({
    url: BASE_URL,
    search: "NYC sublet apartment short term rental for rent",
    source: "leasebreak",
    limit: 500,
  });

  const results: DiscoveredListing[] = [];
  for (const link of mapResult.listingLinks) {
    const match = link.match(/\/short-term-rental-details\/(\d+)\//);
    results.push({
      url: link,
      sourceListingId: match ? match[1] : undefined,
    });
  }

  console.log(
    `[leasebreak] Firecrawl discovered ${results.length} listing URLs`
  );
  return results;
}

export const leasebreakAdapter: SourceAdapter = {
  name: "leasebreak",

  /**
   * Discover listing detail URLs.
   * Two modes:
   *   - Default: fetch seed search pages directly and extract links
   *   - Firecrawl: use Firecrawl /map endpoint (--firecrawl-discover flag)
   */
  async discover(): Promise<DiscoveredListing[]> {
    const useFirecrawl = process.argv.includes("--firecrawl-discover");

    if (useFirecrawl && process.env.FIRECRAWL_API_KEY) {
      return discoverViaFirecrawl();
    }

    return discoverViaSeedPages();
  },

  /**
   * Fetch a Leasebreak detail page using the shared HTTP layer.
   */
  async fetch(url: string): Promise<FetchResult> {
    const result = await fetchWithPolicy(url);
    return {
      httpStatus: result.httpStatus,
      content: result.content,
      finalUrl: result.finalUrl,
    };
  },

  /**
   * Parse a Leasebreak detail page HTML into a NormalizedListingInput.
   */
  async parse(
    content: string,
    meta: { url: string; sourceListingId?: string }
  ): Promise<NormalizedListingInput & { title: string }> {
    const $ = loadHtml(content);

    // --- Address / Title ---
    const address = parseText($, "h2") || parseText($, "title")?.replace(" | LeaseBreak.com", "") || "Unknown";

    // --- Neighborhood / Borough ---
    const locationText = parseText($, ".title-detail-apartments-text");
    let neighborhood: string | null = null;
    let borough: string | null = null;
    if (locationText) {
      const parts = locationText.split(",").map((s) => s.trim());
      if (parts.length >= 2) {
        neighborhood = titleCase(parts[0]);
        borough = normalizeBoroughName(parts[1]);
      } else if (parts.length === 1) {
        neighborhood = titleCase(parts[0]);
      }
    }

    // --- Bedrooms / Bathrooms ---
    let bedrooms: number | null = null;
    let bathrooms: number | null = null;
    $(".title-icon").each((_, el) => {
      const label = $(el).text().trim().toLowerCase();
      const valueEl = $(el).closest("div").find(".nums-icon").first();
      const value = valueEl.text().trim();
      if (label.includes("bedroom")) {
        if (value.toLowerCase().includes("studio")) {
          bedrooms = 0;
        } else {
          bedrooms = parseNumber(value);
        }
      } else if (label.includes("bathroom")) {
        bathrooms = parseNumber(value);
      }
    });

    // --- Rent ---
    // Get the first monthly rent from the pricing table (shortest lease = highest price)
    // or try to find it from other elements
    let rentGross: number | null = null;
    const pricingRows = $("table").first().find("tr");
    if (pricingRows.length > 1) {
      // Skip header row, get the first data row
      const firstDataRow = pricingRows.eq(1);
      const cells = firstDataRow.find("td");
      if (cells.length >= 2) {
        rentGross = parseMoney(cells.eq(1).text());
      }
    }

    // If no pricing table, try to find a price elsewhere
    if (rentGross === null) {
      const priceMatch = content.match(/\$\s*([\d,]+)\s*\/\s*mo/i);
      if (priceMatch) {
        rentGross = parseMoney(`$${priceMatch[1]}`);
      }
    }

    // --- Broker Fee ---
    let brokerFee: boolean | null = null;
    const feeElements = $(".listing-details-value");
    feeElements.each((_, el) => {
      const text = $(el).text().trim().toLowerCase();
      if (text.includes("not charging a brokerage fee")) {
        brokerFee = false;
      } else if (text.includes("charging a brokerage fee") && !text.includes("not")) {
        brokerFee = true;
      }
    });

    // --- Lease Term ---
    let leaseTermMonths: number | null = null;
    // Try to parse from pricing table header
    const pricingHeader = $("h3").filter((_, el) =>
      $(el).text().includes("Pricing Based on Lease Term")
    );
    if (pricingHeader.length > 0) {
      // Get available lease terms from table
      const leaseTerms: number[] = [];
      pricingRows.each((i, el) => {
        if (i === 0) return; // skip header
        const termCell = $(el).find("td").first().text().trim();
        const months = parseLeaseTermMonths(termCell);
        if (months) leaseTerms.push(months);
      });
      // Use the shortest available lease term
      if (leaseTerms.length > 0) {
        leaseTermMonths = Math.min(...leaseTerms);
      }
    }

    // --- Move-in/Move-out dates ---
    let moveInCostNotes: string | null = null;
    const moveInParts: string[] = [];
    $(".title-icon").each((_, el) => {
      const label = $(el).text().trim();
      if (label.includes("Move-In") || label.includes("Move-Out") || label.includes("move-out")) {
        const value = $(el).closest("div").find(".nums-icon, .date-icon").first().text().trim();
        if (value) {
          moveInParts.push(`${label} ${value}`);
        }
      }
    });
    if (moveInParts.length > 0) {
      moveInCostNotes = moveInParts.join("; ");
    }

    // --- Description ---
    let description: string | null = null;
    const propDetailsHeader = $("h2").filter((_, el) =>
      $(el).text().trim() === "Property Details"
    );
    if (propDetailsHeader.length > 0) {
      // Get all following paragraphs until next h2
      const descParts: string[] = [];
      propDetailsHeader
        .nextAll()
        .each((_, el) => {
          if ($(el).prop("tagName") === "H2") return false; // stop at next section
          const text = $(el).text().trim();
          if (text.length > 0) descParts.push(text);
        });
      description = descParts.join("\n").trim() || null;
    }

    // --- Features ---
    const features: string[] = [];
    const featuresHeader = $("h2").filter((_, el) =>
      $(el).text().trim() === "Features"
    );
    if (featuresHeader.length > 0) {
      featuresHeader
        .nextAll("ul, div")
        .first()
        .find("li, span")
        .each((_, el) => {
          const text = $(el).text().trim();
          if (text.length > 0 && text.length < 100) features.push(text);
        });
    }

    // Detect laundry from features
    let laundry: string | null = null;
    for (const f of features) {
      const lower = f.toLowerCase();
      if (lower.includes("washer") && lower.includes("unit")) laundry = "in_unit";
      else if (lower.includes("laundry") && lower.includes("building")) laundry = "in_building";
    }

    // Detect pets from features
    let petPolicy: string | null = null;
    for (const f of features) {
      const lower = f.toLowerCase();
      if (lower.includes("pet friendly")) petPolicy = "pets_allowed";
      else if (lower.includes("no pets")) petPolicy = "no_pets";
      else if (lower.includes("cats")) petPolicy = "cats_only";
      else if (lower.includes("dogs")) petPolicy = "dogs_only";
    }

    // Detect elevator/doorman from features
    let elevator: boolean | null = null;
    let doorman: boolean | null = null;
    for (const f of features) {
      const lower = f.toLowerCase();
      if (lower.includes("elevator")) elevator = true;
      if (lower.includes("doorman")) doorman = true;
    }

    // --- Images ---
    const images = parseAllAttr($, "img", "src").filter(
      (src) => src.includes("images.leasebreak.com") && src.includes("uploads")
    );

    // --- Last Updated ---
    // We don't store this directly, but it's useful for logging
    const lastUpdatedEl = $(".last-updated-details-title").first();
    const lastUpdatedText = lastUpdatedEl.next().text().trim();
    if (lastUpdatedText) {
      console.log(`[leasebreak] Last updated: ${lastUpdatedText}`);
    }

    // Append features to description
    if (features.length > 0 && description) {
      description += "\n\nFeatures: " + features.join(", ");
    } else if (features.length > 0) {
      description = "Features: " + features.join(", ");
    }

    return {
      source: "leasebreak",
      sourceUrl: meta.url,
      title: address,
      description,
      address,
      unit: null, // Leasebreak doesn't typically show unit numbers
      neighborhood,
      borough,
      lat: null, // Would need geocoding
      lng: null,
      rentGross,
      rentNetEffective: null,
      bedrooms,
      bathrooms,
      brokerFee,
      leaseTermMonths,
      moveInCostNotes,
      petPolicy,
      laundry,
      elevator,
      doorman,
      images,
    };
  },
};

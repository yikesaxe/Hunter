// lib/crawlJobs.ts
// App-side CrawlJob sync — called after preference save to create/update
// CrawlJob records that the scraper scheduler picks up.

import { createHash, randomUUID } from "crypto";
import { prisma } from "./db";

const ALL_SOURCES = ["streeteasy", "renthop", "zillow", "leasebreak"] as const;
type Source = (typeof ALL_SOURCES)[number];

type SearchParams = {
  neighborhoods: string[];
  minPrice: number;
  maxPrice: number;
  beds: number[];
  noFee?: boolean;
};

function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lightweight URL builders (mirror of scraper/src/sites/)
// ─────────────────────────────────────────────────────────────────────────────

function buildStreetEasyUrls(p: SearchParams): string[] {
  const slugs = p.neighborhoods.length > 0 && p.neighborhoods.length <= 5
    ? p.neighborhoods.map((n) => n.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-"))
    : ["manhattan"];

  const qs = new URLSearchParams();
  if (p.minPrice || p.maxPrice) qs.set("price", `${p.minPrice ?? 0},${p.maxPrice ?? 50000}`);
  if (p.beds.length > 0) qs.set("beds", p.beds.join(","));
  const query = qs.toString();
  return [`https://streeteasy.com/for-rent/${slugs.join(",")}${query ? `?${query}` : ""}`];
}

function buildRentHopUrls(p: SearchParams): string[] {
  const qs = new URLSearchParams();
  if (p.minPrice) qs.set("min_price", String(p.minPrice));
  if (p.maxPrice) qs.set("max_price", String(p.maxPrice));
  return [`https://www.renthop.com/search/nyc?${qs.toString()}`];
}

function buildZillowUrls(p: SearchParams): string[] {
  const filterState: Record<string, unknown> = {
    fr: { value: true }, fsba: { value: false }, fsbo: { value: false },
    nc: { value: false }, cmsn: { value: false },
  };
  if (p.minPrice || p.maxPrice) {
    const pf: Record<string, number> = {};
    if (p.minPrice) pf.min = p.minPrice;
    if (p.maxPrice) pf.max = p.maxPrice;
    filterState.mp = pf;
    filterState.price = pf;
  }
  if (p.beds.length > 0) {
    filterState.beds = { min: Math.min(...p.beds), max: Math.max(...p.beds) };
  }
  const sqs = JSON.stringify({ pagination: {}, isMapVisible: false, filterState });
  return [`https://www.zillow.com/new-york-ny/rentals/?${new URLSearchParams({ searchQueryState: sqs }).toString()}`];
}

function buildLeaseBreakUrls(p: SearchParams): string[] {
  const qs = new URLSearchParams();
  if (p.minPrice) qs.set("min_rent", String(p.minPrice));
  if (p.maxPrice) qs.set("max_rent", String(p.maxPrice));
  return [`https://leasebreak.com/listings?${qs.toString()}`];
}

function buildUrls(source: Source, p: SearchParams): string[] {
  switch (source) {
    case "streeteasy": return buildStreetEasyUrls(p);
    case "renthop":    return buildRentHopUrls(p);
    case "zillow":     return buildZillowUrls(p);
    case "leasebreak": return buildLeaseBreakUrls(p);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upsert CrawlJobs for each (source × searchUrl) derived from a device's
 * preferences. Runs in the background after a preference save.
 * The scraper scheduler will pick up the jobs on its next tick.
 */
export async function syncCrawlJobsForDevice(deviceId: string): Promise<void> {
  const prefs = await prisma.preference.findUnique({ where: { deviceId } });
  if (!prefs) return;

  const params: SearchParams = {
    neighborhoods: prefs.neighborhoods as string[],
    minPrice: prefs.minPrice,
    maxPrice: prefs.maxPrice,
    beds: prefs.beds as number[],
  };

  for (const source of ALL_SOURCES) {
    const urls = buildUrls(source, params);
    for (const searchUrl of urls) {
      const searchUrlHash = hashUrl(searchUrl);
      await prisma.crawlJob.upsert({
        where: { deviceId_source_searchUrlHash: { deviceId, source, searchUrlHash } },
        create: {
          id: randomUUID(),
          deviceId,
          source,
          searchUrl,
          searchUrlHash,
          status: "idle",
          nextRunAt: new Date(), // due immediately
        },
        update: { searchUrl },
      });
    }
  }
}

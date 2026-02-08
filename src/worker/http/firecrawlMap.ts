/**
 * Firecrawl /map endpoint for discovering listing URLs across a site.
 * Much faster than /scrape for discovery — returns URLs without rendering pages.
 */
import { prisma } from "@/lib/prisma";

const FIRECRAWL_MAP_URL = "https://api.firecrawl.dev/v1/map";

/** Track last map call time for rate limiting */
let lastMapCallTime = 0;
const MAP_COOLDOWN_MS = 2000; // 2 seconds between map calls

/** URL patterns for known listing sources */
const SOURCE_PATTERNS: Record<string, RegExp> = {
  leasebreak: /\/short-term-rental-details\/\d+\//,
  streeteasy: /\/building\/[a-z0-9_-]+\/[a-z0-9_-]+$/i,
};

export interface MapOptions {
  /** Base URL for the site to map */
  url: string;
  /** Search query to bias discovery toward relevant pages */
  search: string;
  /** Max number of links to return (default 500) */
  limit?: number;
  /** Source name to filter links with (uses SOURCE_PATTERNS) */
  source?: string;
}

export interface MapResult {
  allLinks: string[];
  listingLinks: string[];
}

/**
 * Discover URLs via Firecrawl's /map endpoint.
 * Returns all links and filtered listing links (deduped).
 */
export async function mapViaFirecrawl(opts: MapOptions): Promise<MapResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY not set.");
  }

  // Rate limit between map calls
  const now = Date.now();
  const elapsed = now - lastMapCallTime;
  if (elapsed < MAP_COOLDOWN_MS) {
    const wait = MAP_COOLDOWN_MS - elapsed;
    console.log(`[firecrawl-map] Rate limiting: waiting ${wait}ms`);
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
  lastMapCallTime = Date.now();

  console.log(`[firecrawl-map] Mapping ${opts.url} (search: "${opts.search}")`);

  const response = await fetch(FIRECRAWL_MAP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url: opts.url,
      search: opts.search,
      limit: opts.limit ?? 500,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `[firecrawl-map] API error ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const data = await response.json();

  if (!data.success || !data.links) {
    throw new Error("[firecrawl-map] No links returned");
  }

  const allLinks: string[] = data.links;
  const seen = new Set<string>();
  const listingLinks: string[] = [];

  const pattern = opts.source ? SOURCE_PATTERNS[opts.source] : null;

  for (const link of allLinks) {
    if (seen.has(link)) continue;
    seen.add(link);

    if (pattern) {
      if (pattern.test(link)) {
        listingLinks.push(link);
      }
    } else {
      // No source filter — check all patterns
      for (const pat of Object.values(SOURCE_PATTERNS)) {
        if (pat.test(link)) {
          listingLinks.push(link);
          break;
        }
      }
    }
  }

  console.log(
    `[firecrawl-map] Found ${allLinks.length} total links, ${listingLinks.length} listing URLs`
  );

  return { allLinks, listingLinks };
}

/**
 * Filter a list of URLs to only those not already in the NormalizedListing table.
 * Returns only the new/unseen URLs.
 */
export async function filterNewUrls(
  urls: string[],
  source: string
): Promise<string[]> {
  if (urls.length === 0) return [];

  // Batch query: find all existing sourceUrls for this source
  const existing = await prisma.normalizedListing.findMany({
    where: {
      source,
      sourceUrl: { in: urls },
    },
    select: { sourceUrl: true },
  });

  const existingSet = new Set(existing.map((e) => e.sourceUrl));
  const newUrls = urls.filter((url) => !existingSet.has(url));

  console.log(
    `[filterNewUrls] ${urls.length} total → ${newUrls.length} new (${existingSet.size} already seen)`
  );

  return newUrls;
}

/**
 * User-Targeted Crawler — reads SavedSearch preferences and creates
 * targeted scraping jobs that discover listings matching those preferences.
 */
import { prisma } from "@/lib/prisma";
import { mapViaFirecrawl, filterNewUrls } from "../http/firecrawlMap";
import { ingestOne } from "./ingest";
import { dedupeAndUpsertCanonical } from "./dedupe";
import { updateFreshness } from "./freshness";
import { leasebreakAdapter } from "../adapters/leasebreak";
import { streeteasyAdapter } from "../adapters/streeteasy";
import { SourceAdapter } from "../adapters/SourceAdapter";

const SOURCES: Record<string, { url: string; adapter: SourceAdapter }> = {
  leasebreak: {
    url: "https://www.leasebreak.com",
    adapter: leasebreakAdapter,
  },
  streeteasy: {
    url: "https://streeteasy.com",
    adapter: streeteasyAdapter,
  },
};

/** Max URLs to ingest per saved search per run */
const MAX_PER_SEARCH = 20;

/**
 * Build a Firecrawl map search query from a SavedSearch's preferences.
 */
function buildSearchQuery(search: {
  prompt: string;
  maxRent: number | null;
  minBeds: number | null;
  borough: string | null;
  neighborhood: string | null;
  noFeePreferred: boolean | null;
}): string {
  const parts: string[] = ["NYC apartment for rent"];

  if (search.borough) parts.push(search.borough);
  if (search.neighborhood) parts.push(search.neighborhood);
  if (search.maxRent) parts.push(`under $${search.maxRent}`);
  if (search.minBeds) {
    parts.push(
      search.minBeds === 0
        ? "studio"
        : `${search.minBeds} bedroom`
    );
  }
  if (search.noFeePreferred) parts.push("no fee");

  // Include the user's natural language prompt for richer discovery
  if (search.prompt && search.prompt.length < 200) {
    parts.push(search.prompt);
  }

  return parts.join(" ");
}

/**
 * Run user-targeted crawling based on all active SavedSearches.
 */
export async function runUserTargetedCrawler(): Promise<void> {
  const searches = await prisma.savedSearch.findMany({
    where: { isActive: true },
  });

  if (searches.length === 0) {
    console.log(
      "[user-targeted] No active saved searches. Create one via POST /api/searches"
    );
    return;
  }

  console.log(
    `[user-targeted] Processing ${searches.length} active saved search(es)`
  );

  for (const search of searches) {
    console.log(
      `\n[user-targeted] Search "${search.name}": ${search.prompt}`
    );

    const query = buildSearchQuery(search);
    console.log(`[user-targeted] Discovery query: "${query}"`);

    // Run against each source
    for (const [sourceName, sourceConfig] of Object.entries(SOURCES)) {
      // Only use StreetEasy if Firecrawl is available
      if (sourceName === "streeteasy" && !process.env.FIRECRAWL_API_KEY) {
        continue;
      }

      try {
        // Upsert a ScrapeJob for tracking
        const existingJob = await prisma.scrapeJob.findFirst({
          where: {
            source: sourceName,
            mode: "user_targeted",
            query,
            status: "active",
          },
        });

        const job =
          existingJob ??
          (await prisma.scrapeJob.create({
            data: {
              source: sourceName,
              mode: "user_targeted",
              query,
              targetCount: MAX_PER_SEARCH,
            },
          }));

        // Discover via Firecrawl map
        const mapResult = await mapViaFirecrawl({
          url: sourceConfig.url,
          search: query,
          source: sourceName,
          limit: 200,
        });

        // Filter to new URLs
        const newUrls = await filterNewUrls(
          mapResult.listingLinks,
          sourceName
        );

        const batch = newUrls.slice(0, MAX_PER_SEARCH);
        if (batch.length === 0) {
          console.log(
            `[user-targeted] No new ${sourceName} URLs for "${search.name}"`
          );
          continue;
        }

        console.log(
          `[user-targeted] Ingesting ${batch.length} new ${sourceName} listings for "${search.name}"`
        );

        let ingested = 0;
        let added = 0;

        for (const url of batch) {
          try {
            const id =
              url.match(/\/(\d+)\//)?.[1] ||
              url.match(/\/building\/(.+)$/)?.[1];

            const normalizedId = await ingestOne(
              sourceConfig.adapter,
              url,
              id
            );

            if (normalizedId) {
              ingested++;
              const result = await dedupeAndUpsertCanonical(normalizedId);
              if (result?.createdNew) added++;
            }
          } catch (err) {
            console.error(
              `[user-targeted] Error ingesting ${url}:`,
              err
            );
          }
        }

        // Update job stats
        await prisma.scrapeJob.update({
          where: { id: job.id },
          data: {
            discoveredCount: { increment: mapResult.listingLinks.length },
            ingestedCount: { increment: ingested },
            canonicalAddedCount: { increment: added },
          },
        });

        console.log(
          `[user-targeted] ${sourceName}: ingested ${ingested}, added ${added} new canonical units`
        );
      } catch (err) {
        console.error(
          `[user-targeted] Error with ${sourceName} for "${search.name}":`,
          err
        );
      }
    }
  }

  // Update freshness at the end
  console.log("\n[user-targeted] Updating freshness...");
  await updateFreshness();
}

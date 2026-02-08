/**
 * Registry Crawler — fills the CanonicalUnit registry to a target count.
 *
 * Algorithm:
 * 1. Check current canonical unit count
 * 2. Discover candidate listing URLs via Firecrawl map
 * 3. Filter to new (unseen) URLs
 * 4. Ingest batches, deduplicating into canonical units
 * 5. Repeat until target count reached or no more URLs
 */
import { prisma } from "@/lib/prisma";
import { mapViaFirecrawl, filterNewUrls } from "../http/firecrawlMap";
import { ingestOne } from "./ingest";
import { dedupeAndUpsertCanonical } from "./dedupe";
import { updateFreshness } from "./freshness";
import { leasebreakAdapter } from "../adapters/leasebreak";
import { streeteasyAdapter } from "../adapters/streeteasy";
import { SourceAdapter } from "../adapters/SourceAdapter";

/** Discovery queries per source */
const DISCOVERY_CONFIGS: Record<
  string,
  { url: string; search: string; adapter: SourceAdapter }
> = {
  leasebreak: {
    url: "https://www.leasebreak.com",
    search: "NYC sublet apartment short term rental for rent",
    adapter: leasebreakAdapter,
  },
  streeteasy: {
    url: "https://streeteasy.com",
    search: "building apartment for rent rental listing",
    adapter: streeteasyAdapter,
  },
};

export interface RegistryCrawlerOptions {
  /** Sources to crawl (default: both leasebreak + streeteasy) */
  sources?: string[];
  /** Target number of canonical units (default: 200) */
  targetCanonicalCount?: number;
  /** Max URLs to attempt per run across all sources (default: 200) */
  maxUrlsPerRun?: number;
  /** Batch size per discovery round (default: 30) */
  batchSize?: number;
}

export interface RegistryCrawlerStats {
  startingCanonicalCount: number;
  endingCanonicalCount: number;
  totalDiscovered: number;
  totalNewUrls: number;
  totalIngested: number;
  totalCanonicalAdded: number;
  totalErrors: number;
}

const MAX_LOOPS = 10; // safety limit to prevent infinite loops

export async function runRegistryCrawler(
  opts: RegistryCrawlerOptions = {}
): Promise<RegistryCrawlerStats> {
  const {
    sources = ["leasebreak", "streeteasy"],
    targetCanonicalCount = 200,
    maxUrlsPerRun = 200,
    batchSize = 30,
  } = opts;

  const stats: RegistryCrawlerStats = {
    startingCanonicalCount: 0,
    endingCanonicalCount: 0,
    totalDiscovered: 0,
    totalNewUrls: 0,
    totalIngested: 0,
    totalCanonicalAdded: 0,
    totalErrors: 0,
  };

  stats.startingCanonicalCount = await prisma.canonicalUnit.count();
  console.log(
    `[registry] Starting with ${stats.startingCanonicalCount} canonical units (target: ${targetCanonicalCount})`
  );

  if (stats.startingCanonicalCount >= targetCanonicalCount) {
    console.log("[registry] Already at target count. Nothing to do.");
    stats.endingCanonicalCount = stats.startingCanonicalCount;
    return stats;
  }

  // Create/update a ScrapeJob for tracking
  const job = await prisma.scrapeJob.create({
    data: {
      source: sources.join("+"),
      mode: "seed_registry",
      query: `Fill registry to ${targetCanonicalCount}`,
      targetCount: targetCanonicalCount,
    },
  });

  let totalUrlsAttempted = 0;
  let loop = 0;

  while (loop < MAX_LOOPS && totalUrlsAttempted < maxUrlsPerRun) {
    loop++;
    const currentCount = await prisma.canonicalUnit.count();
    console.log(
      `\n[registry] Loop ${loop}: ${currentCount}/${targetCanonicalCount} canonical units, ${totalUrlsAttempted}/${maxUrlsPerRun} URLs attempted`
    );

    if (currentCount >= targetCanonicalCount) {
      console.log("[registry] Target reached!");
      break;
    }

    // Discover from each source
    for (const sourceName of sources) {
      const config = DISCOVERY_CONFIGS[sourceName];
      if (!config) {
        console.warn(`[registry] Unknown source: ${sourceName}`);
        continue;
      }

      if (totalUrlsAttempted >= maxUrlsPerRun) break;

      try {
        // Discover URLs
        const mapResult = await mapViaFirecrawl({
          url: config.url,
          search: config.search,
          source: sourceName,
          limit: 500,
        });

        stats.totalDiscovered += mapResult.listingLinks.length;

        // Filter to new URLs only
        const newUrls = await filterNewUrls(
          mapResult.listingLinks,
          sourceName
        );
        stats.totalNewUrls += newUrls.length;

        if (newUrls.length === 0) {
          console.log(`[registry] No new URLs from ${sourceName}`);
          continue;
        }

        // Take a batch
        const remaining = maxUrlsPerRun - totalUrlsAttempted;
        const batch = newUrls.slice(0, Math.min(batchSize, remaining));
        console.log(
          `[registry] Ingesting batch of ${batch.length} from ${sourceName}`
        );

        // Ingest each URL
        for (const url of batch) {
          totalUrlsAttempted++;

          try {
            const normalizedId = await ingestOne(
              config.adapter,
              url,
              url.match(/\/(\d+)\//)?.[1] ||
                url.match(/\/building\/(.+)$/)?.[1]
            );

            if (normalizedId) {
              stats.totalIngested++;

              // Dedupe and check if a new canonical was created
              const result = await dedupeAndUpsertCanonical(normalizedId);
              if (result?.createdNew) {
                stats.totalCanonicalAdded++;
              }
            }
          } catch (err) {
            stats.totalErrors++;
            console.error(`[registry] Error ingesting ${url}:`, err);
          }

          // Check if we've hit the target
          if (
            stats.totalCanonicalAdded + stats.startingCanonicalCount >=
            targetCanonicalCount
          ) {
            console.log("[registry] Target reached mid-batch!");
            break;
          }
        }
      } catch (err) {
        console.error(
          `[registry] Error discovering from ${sourceName}:`,
          err
        );
      }
    }

    // If we didn't find any new URLs from any source, stop
    if (stats.totalNewUrls === 0) {
      console.log("[registry] No new URLs found from any source. Stopping.");
      break;
    }
  }

  // Update freshness at the end
  console.log("\n[registry] Updating freshness...");
  await updateFreshness();

  stats.endingCanonicalCount = await prisma.canonicalUnit.count();

  // Update the job
  await prisma.scrapeJob.update({
    where: { id: job.id },
    data: {
      discoveredCount: stats.totalDiscovered,
      ingestedCount: stats.totalIngested,
      canonicalAddedCount: stats.totalCanonicalAdded,
      status:
        stats.endingCanonicalCount >= targetCanonicalCount
          ? "paused"
          : "active",
    },
  });

  console.log("\n[registry] === Summary ===");
  console.log(`  Starting canonical units: ${stats.startingCanonicalCount}`);
  console.log(`  Ending canonical units:   ${stats.endingCanonicalCount}`);
  console.log(`  URLs discovered:          ${stats.totalDiscovered}`);
  console.log(`  New URLs (unseen):        ${stats.totalNewUrls}`);
  console.log(`  Successfully ingested:    ${stats.totalIngested}`);
  console.log(`  New canonical units:      ${stats.totalCanonicalAdded}`);
  console.log(`  Errors:                   ${stats.totalErrors}`);

  return stats;
}

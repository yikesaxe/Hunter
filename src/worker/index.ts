import "dotenv/config";
import { ingestAll, ingestAdapter } from "./pipeline/ingest";
import { dedupeAll } from "./pipeline/dedupe";
import { updateFreshness } from "./pipeline/freshness";
import { mockStreetEasyAdapter } from "./adapters/mockStreetEasy";
import { mockCraigslistAdapter } from "./adapters/mockCraigslist";
import { leasebreakAdapter } from "./adapters/leasebreak";
import { SourceAdapter } from "./adapters/SourceAdapter";

// TODO: Dedalus ADK tool wrapper — expose ingest/search as callable tools

/** Parse CLI args */
function parseArgs(): { source?: string; limit?: number } {
  const args = process.argv.slice(2);
  const result: { source?: string; limit?: number } = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--source" && args[i + 1]) {
      result.source = args[++i];
    } else if (args[i] === "--limit" && args[i + 1]) {
      result.limit = parseInt(args[++i], 10);
    }
  }
  return result;
}

const MOCK_ADAPTERS: SourceAdapter[] = [
  mockStreetEasyAdapter,
  mockCraigslistAdapter,
];

async function main() {
  const { source, limit } = parseArgs();

  console.log("=== Hunter Worker Starting ===");

  if (source === "streeteasy") {
    console.error(
      "\n[worker] StreetEasy crawling is disabled (robots.txt restrictions)."
    );
    console.error(
      "[worker] Use the import endpoint instead: POST /api/import/streeteasy"
    );
    console.error(
      "[worker] Or use --source streeteasyImport to import from /imports/streeteasy/*.html"
    );
    process.exit(1);
  }

  let adapters: SourceAdapter[];

  if (source === "leasebreak") {
    adapters = [leasebreakAdapter];
  } else if (source === "mock") {
    adapters = MOCK_ADAPTERS;
  } else if (source === "streeteasyImport") {
    // Will be implemented in step 4 — import from local files
    console.log("[worker] StreetEasy import from /imports/ — not yet implemented");
    process.exit(0);
  } else if (!source) {
    // Default: run all automated sources
    adapters = [...MOCK_ADAPTERS, leasebreakAdapter];
  } else {
    console.error(`[worker] Unknown source: ${source}`);
    console.error(
      "[worker] Available sources: leasebreak, mock, streeteasyImport"
    );
    process.exit(1);
  }

  console.log(
    `Adapters: ${adapters.map((a) => a.name).join(", ")}${limit ? ` (limit: ${limit})` : ""}`
  );

  // Phase 1: Ingestion
  console.log("\n--- Phase 1: Ingestion ---");
  await ingestAll(adapters, { limit });

  // Phase 2: Deduplicate and canonicalize
  console.log("\n--- Phase 2: Deduplication ---");
  await dedupeAll();

  // Phase 3: Update freshness state
  console.log("\n--- Phase 3: Freshness ---");
  await updateFreshness();

  console.log("\n=== Hunter Worker Complete ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});

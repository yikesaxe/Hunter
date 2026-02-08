import "dotenv/config";
import { ingestAll } from "./pipeline/ingest";
import { dedupeAll } from "./pipeline/dedupe";
import { updateFreshness } from "./pipeline/freshness";
import { mockStreetEasyAdapter } from "./adapters/mockStreetEasy";
import { mockCraigslistAdapter } from "./adapters/mockCraigslist";
import { SourceAdapter } from "./adapters/SourceAdapter";

// TODO: Dedalus ADK tool wrapper — expose ingest/search as callable tools

const adapters: SourceAdapter[] = [
  mockStreetEasyAdapter,
  mockCraigslistAdapter,
];

async function main() {
  console.log("=== Hunter Worker Starting ===");
  console.log(`Adapters: ${adapters.map((a) => a.name).join(", ")}`);

  // Step 1: Ingest all sources
  console.log("\n--- Phase 1: Ingestion ---");
  await ingestAll(adapters);

  // Step 2: Deduplicate and canonicalize
  console.log("\n--- Phase 2: Deduplication ---");
  await dedupeAll();

  // Step 3: Update freshness state
  console.log("\n--- Phase 3: Freshness ---");
  await updateFreshness();

  console.log("\n=== Hunter Worker Complete ===");
  process.exit(0);
}

main().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});

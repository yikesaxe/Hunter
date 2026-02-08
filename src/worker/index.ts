import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { ingestAll, ingestAdapter, ingestOne } from "./pipeline/ingest";
import { dedupeAll, dedupeAndUpsertCanonical } from "./pipeline/dedupe";
import { updateFreshness } from "./pipeline/freshness";
import { mockStreetEasyAdapter } from "./adapters/mockStreetEasy";
import { mockCraigslistAdapter } from "./adapters/mockCraigslist";
import { leasebreakAdapter } from "./adapters/leasebreak";
import { streeteasyAdapter } from "./adapters/streeteasy";
import { parseStreetEasyHtml } from "./adapters/streeteasyImport";
import { SourceAdapter } from "./adapters/SourceAdapter";
import { prisma } from "@/lib/prisma";

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

/**
 * Import StreetEasy listings from HTML files in /imports/streeteasy/*.html.
 * Each file should be named with a URL-safe identifier and contain page source HTML.
 * A .url sidecar file can optionally contain the original listing URL.
 */
async function importStreetEasyFromFolder(): Promise<void> {
  const importsDir = path.resolve(process.cwd(), "imports/streeteasy");

  if (!fs.existsSync(importsDir)) {
    console.log(
      `[worker] No imports directory found at ${importsDir}. Create it and add .html files.`
    );
    return;
  }

  const htmlFiles = fs
    .readdirSync(importsDir)
    .filter((f) => f.endsWith(".html"));

  if (htmlFiles.length === 0) {
    console.log("[worker] No .html files found in /imports/streeteasy/");
    return;
  }

  console.log(
    `[worker] Importing ${htmlFiles.length} StreetEasy HTML files from ${importsDir}`
  );

  const PARSE_VERSION = "1.0.0";

  for (const file of htmlFiles) {
    const filePath = path.join(importsDir, file);
    const html = fs.readFileSync(filePath, "utf-8");

    // Check for a .url sidecar file with the original URL
    const urlFile = filePath.replace(/\.html$/, ".url");
    let url = `file://${filePath}`;
    if (fs.existsSync(urlFile)) {
      url = fs.readFileSync(urlFile, "utf-8").trim();
    }

    console.log(`[worker] Importing ${file} (url: ${url})`);

    try {
      const now = new Date();
      const parsed = parseStreetEasyHtml(html, { url });

      // Store RawListing
      const rawListing = await prisma.rawListing.upsert({
        where: {
          source_sourceUrl: { source: "streeteasy", sourceUrl: url },
        },
        update: {
          fetchedAt: now,
          httpStatus: 200,
          rawContent: html,
          parseVersion: PARSE_VERSION,
        },
        create: {
          source: "streeteasy",
          sourceUrl: url,
          fetchedAt: now,
          httpStatus: 200,
          rawContent: html,
          parseVersion: PARSE_VERSION,
        },
      });

      await prisma.rawListing.update({
        where: { id: rawListing.id },
        data: { extractedJson: JSON.parse(JSON.stringify(parsed)) },
      });

      // Upsert NormalizedListing
      const normalized = await prisma.normalizedListing.upsert({
        where: {
          source_sourceUrl: { source: "streeteasy", sourceUrl: url },
        },
        update: {
          rawListingId: rawListing.id,
          title: parsed.title,
          description: parsed.description,
          address: parsed.address,
          unit: parsed.unit,
          neighborhood: parsed.neighborhood,
          borough: parsed.borough,
          rentGross: parsed.rentGross,
          rentNetEffective: parsed.rentNetEffective,
          bedrooms: parsed.bedrooms,
          bathrooms: parsed.bathrooms,
          brokerFee: parsed.brokerFee,
          images: parsed.images ?? [],
          lastSeenAt: now,
        },
        create: {
          rawListingId: rawListing.id,
          source: "streeteasy",
          sourceUrl: url,
          title: parsed.title,
          description: parsed.description,
          address: parsed.address,
          unit: parsed.unit,
          neighborhood: parsed.neighborhood,
          borough: parsed.borough,
          rentGross: parsed.rentGross,
          rentNetEffective: parsed.rentNetEffective,
          bedrooms: parsed.bedrooms,
          bathrooms: parsed.bathrooms,
          brokerFee: parsed.brokerFee,
          images: parsed.images ?? [],
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });

      console.log(
        `[worker] Imported "${parsed.title}" (${parsed.rentGross ? "$" + parsed.rentGross : "no rent"}, ${parsed.bedrooms ?? "?"} bed)`
      );

      // Dedupe immediately
      await dedupeAndUpsertCanonical(normalized.id);
    } catch (err) {
      console.error(`[worker] Error importing ${file}:`, err);
    }
  }
}

async function main() {
  const { source, limit } = parseArgs();

  console.log("=== Hunter Worker Starting ===");

  let adapters: SourceAdapter[];

  if (source === "streeteasy") {
    if (!process.env.FIRECRAWL_API_KEY) {
      console.error(
        "\n[worker] StreetEasy requires FIRECRAWL_API_KEY in .env"
      );
      console.error(
        "[worker] Or use --source streeteasyImport to import from /imports/streeteasy/*.html"
      );
      process.exit(1);
    }
    adapters = [streeteasyAdapter];
  } else if (source === "leasebreak") {
    adapters = [leasebreakAdapter];
  } else if (source === "mock") {
    adapters = MOCK_ADAPTERS;
  } else if (source === "streeteasyImport") {
    await importStreetEasyFromFolder();
    // Still run dedupe + freshness after import
    console.log("\n--- Phase 2: Deduplication ---");
    await dedupeAll();
    console.log("\n--- Phase 3: Freshness ---");
    await updateFreshness();
    console.log("\n=== Hunter Worker Complete ===");
    process.exit(0);
  } else if (!source) {
    // Default: run all automated sources
    adapters = [...MOCK_ADAPTERS, leasebreakAdapter];
    if (process.env.FIRECRAWL_API_KEY) {
      adapters.push(streeteasyAdapter);
    }
  } else {
    console.error(`[worker] Unknown source: ${source}`);
    console.error(
      "[worker] Available sources: streeteasy, leasebreak, mock, streeteasyImport"
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

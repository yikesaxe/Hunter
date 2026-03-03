// scripts/checkRaw.ts — dump raw scrape data for the last N listings
import "dotenv/config";
import { prisma } from "../lib/db.js";

async function main() {
  const raws = await prisma.rawListing.findMany({
    take: 10,
    orderBy: { scrapedAt: "desc" },
    select: { sourceUrl: true, scrapedAt: true, rawData: true },
  });

  for (const r of raws) {
    const d = r.rawData as Record<string, unknown>;
    console.log(`\n[${(r.rawData as any).source}] ${r.sourceUrl}`);
    console.log(`  extractedBy: ${JSON.stringify(d.extractedBy)}`);
    console.log(`  beds=${d.beds} baths=${d.baths} sqft=${d.sqft} price=${d.price}`);
    console.log(`  desc(${String(d.description ?? "").length}): ${String(d.description ?? "").slice(0, 150)}`);
    const features = d.features as string[];
    console.log(`  features(${features?.length ?? 0}): ${features?.slice(0, 4).join(" | ") || "none"}`);
    const extras = d.extras as Record<string, unknown> | null;
    console.log(`  extras: ${extras && Object.keys(extras).length ? JSON.stringify(extras, null, 2) : "none"}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

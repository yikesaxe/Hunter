// scripts/backfillAnalyzeText.ts
// Enqueue analyze-text jobs for all active listings that haven't been analyzed yet
// (or whose content has changed since last analysis).
//
// Usage: npm run backfill:analyze-text

import "dotenv/config";
import { PrismaClient } from "../node_modules/.prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { getAnalyzeTextQueue, closeQueues } from "../scraper/src/queues.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as never) as any;

async function main() {
  // Fetch all active listings with their analysis (if any)
  const listings = await prisma.normalizedListing.findMany({
    where: { status: "active" },
    select: {
      id: true,
      contentHash: true,
      analysis: { select: { textHash: true } },
    },
  });

  // Include if no analysis OR if content hash has changed since last analysis
  const toAnalyze = listings.filter(
    (l: any) => !l.analysis || l.analysis.textHash !== l.contentHash
  );

  console.log(`Found ${toAnalyze.length} of ${listings.length} active listings needing text analysis`);

  const queue = getAnalyzeTextQueue();
  let enqueued = 0;

  for (const listing of toAnalyze) {
    await queue.add(
      "analyze-text",
      { listingId: listing.id },
      { jobId: `analyze-backfill-${listing.id}` }
    );
    enqueued++;
    if (enqueued % 100 === 0) {
      console.log(`  Enqueued ${enqueued}/${toAnalyze.length}…`);
    }
  }

  console.log(`Done. Enqueued ${enqueued} analyze-text jobs.`);
  await closeQueues();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

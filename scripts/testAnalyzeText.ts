import "dotenv/config";
import { PrismaClient } from "../node_modules/.prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { getAnalyzeTextQueue, closeQueues } from "../scraper/src/queues.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as never) as any;

async function main() {
  const listings = await prisma.normalizedListing.findMany({
    where: { status: "active", description: { not: null } },
    take: 10,
    select: { id: true },
  });

  console.log(`Enqueueing ${listings.length} test analyze-text jobs…`);
  const queue = getAnalyzeTextQueue();

  for (const l of listings) {
    await queue.add("analyze-text", { listingId: l.id }, { jobId: `analyze-test-${l.id}` });
    console.log(`  queued ${l.id}`);
  }

  await closeQueues();
  await prisma.$disconnect();
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });

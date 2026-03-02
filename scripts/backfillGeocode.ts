// scripts/backfillGeocode.ts
// Enqueue geocode jobs for all existing listings that have an address but no coordinates.
// Usage: npx tsx scripts/backfillGeocode.ts

import "dotenv/config";
import { PrismaClient } from "../node_modules/.prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { getGeocodeQueue } from "../scraper/src/queues.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as never);

async function main() {
  const listings = await (prisma as any).normalizedListing.findMany({
    where: {
      latitude: null,
      address: { not: null },
      status: { not: "removed" },
    },
    select: { id: true, address: true, source: true },
  });

  console.log(`Enqueueing geocode jobs for ${listings.length} listings without coordinates…`);

  const queue = getGeocodeQueue();
  let enqueued = 0;

  for (const listing of listings) {
    await queue.add("geocode-listing", { listingId: listing.id });
    enqueued++;
  }

  console.log(`Done. Enqueued ${enqueued} geocode jobs.`);
  await queue.close();
  await (prisma as any).$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });

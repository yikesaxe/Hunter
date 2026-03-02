// scripts/backfillCanonicals.ts
// One-time backfill: link existing NormalizedListings to CanonicalUnits.
//
// Usage: npx tsx scripts/backfillCanonicals.ts
//
// Safe to re-run: already-linked listings are skipped.

import "dotenv/config";
import { PrismaClient } from "../node_modules/.prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { findOrCreateCanonical } from "../scraper/src/canonicalize.js";
import { updateCanonicalUnitCount } from "../scraper/src/db.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as never);

async function main() {
  const listings = await (prisma as any).normalizedListing.findMany({
    where: { status: { not: "removed" }, canonicalUnitId: null },
    select: {
      id: true, source: true, address: true, unit: true,
      latitude: true, longitude: true, beds: true, baths: true,
      neighborhood: true, borough: true, zip: true, sqft: true,
      canonicalUnitId: true,
    },
    orderBy: { firstSeenAt: "asc" }, // oldest first → stable canonical ownership
  });

  console.log(`Backfilling ${listings.length} unlinked listings…`);
  let linked = 0;
  let skipped = 0;

  for (const listing of listings) {
    // Re-check in case an earlier iteration already linked it (as a peer)
    const current = await (prisma as any).normalizedListing.findUnique({
      where: { id: listing.id },
      select: { canonicalUnitId: true },
    });
    if (current?.canonicalUnitId) { skipped++; continue; }

    const canonicalId = await findOrCreateCanonical(prisma as any, listing);
    if (canonicalId) {
      await (prisma as any).normalizedListing.update({
        where: { id: listing.id },
        data: { canonicalUnitId: canonicalId },
      });
      await updateCanonicalUnitCount(canonicalId);
      linked++;
    }
  }

  console.log(`Done. Linked ${linked}, already linked/skipped ${skipped}, no match ${listings.length - linked - skipped}.`);
  await (prisma as any).$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });

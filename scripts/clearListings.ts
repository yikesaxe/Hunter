// scripts/clearListings.ts
// Wipes all listing-related tables in FK-safe order.
// Keeps: Device, Preference, DeviceProfile, SubwayStation
//
// Run: npx tsx scripts/clearListings.ts

import "dotenv/config";
import { prisma } from "../lib/db.js";

async function main() {
  console.log("Clearing listing tables...");

  const analysis = await prisma.listingAnalysis.deleteMany();
  console.log(`  ListingAnalysis: ${analysis.count}`);

  const rawListings = await prisma.rawListing.deleteMany();
  console.log(`  RawListing:      ${rawListings.count}`);

  const changeLogs = await prisma.changeLog.deleteMany();
  console.log(`  ChangeLog:       ${changeLogs.count}`);

  const seenUrls = await prisma.crawlRunSeen.deleteMany();
  console.log(`  CrawlRunSeen:    ${seenUrls.count}`);

  const events = await prisma.event.deleteMany();
  console.log(`  Event:           ${events.count}`);

  const listings = await prisma.normalizedListing.deleteMany();
  console.log(`  NormalizedListing: ${listings.count}`);

  const canonicals = await prisma.canonicalUnit.deleteMany();
  console.log(`  CanonicalUnit:   ${canonicals.count}`);

  const runs = await prisma.crawlRun.deleteMany();
  console.log(`  CrawlRun:        ${runs.count}`);

  const jobs = await prisma.crawlJob.deleteMany();
  console.log(`  CrawlJob:        ${jobs.count}`);

  console.log("\nDone. Device, Preference, DeviceProfile, SubwayStation untouched.");
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

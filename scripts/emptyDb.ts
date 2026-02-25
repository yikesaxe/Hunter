import "dotenv/config";
import { prisma } from "../lib/db.js";

async function main() {
  const [listings, runs] = await Promise.all([
    prisma.listing.deleteMany(),
    prisma.crawlRun.deleteMany(),
  ]);
  console.log(`✅ Deleted ${listings.count} listings and ${runs.count} crawl runs`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

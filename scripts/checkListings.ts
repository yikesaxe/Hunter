// scripts/checkListings.ts — inspect scraped listing quality
import "dotenv/config";
import { prisma } from "../lib/db.js";

async function main() {
  const listings = await prisma.normalizedListing.findMany({
    select: {
      source: true, address: true, beds: true, baths: true, sqft: true,
      description: true, amenities: true, scrapedExtras: true,
      rentGross: true, brokerName: true, status: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Total listings: ${listings.length}\n`);

  const bySource: Record<string, number> = {};
  let withDesc = 0, withAmen = 0, withExtras = 0, withSqft = 0, withBroker = 0;

  for (const l of listings) {
    bySource[l.source] = (bySource[l.source] ?? 0) + 1;
    const amen: string[] = (() => { try { return JSON.parse(l.amenities); } catch { return []; } })();
    const extras = l.scrapedExtras as Record<string, unknown> | null;
    if (l.description) withDesc++;
    if (amen.length > 0) withAmen++;
    if (extras && Object.keys(extras).length > 0) withExtras++;
    if (l.sqft) withSqft++;
    if (l.brokerName) withBroker++;
  }

  console.log("By source:", JSON.stringify(bySource));
  console.log(`With description: ${withDesc}/${listings.length}`);
  console.log(`With amenities:   ${withAmen}/${listings.length}`);
  console.log(`With sqft:        ${withSqft}/${listings.length}`);
  console.log(`With extras:      ${withExtras}/${listings.length}`);
  console.log(`With broker name: ${withBroker}/${listings.length}`);

  console.log("\n── Per-listing detail ──");
  for (const l of listings) {
    const amen: string[] = (() => { try { return JSON.parse(l.amenities); } catch { return []; } })();
    const extras = l.scrapedExtras as Record<string, unknown> | null;
    console.log(`\n[${l.source}] ${l.address ?? "no addr"} | ${l.beds ?? "?"}BR ${l.baths ?? "?"}ba ${l.sqft ? l.sqft + "sqft" : ""} | $${l.rentGross ?? "?"}`);
    console.log(`  desc(${l.description?.length ?? 0}): ${l.description ? l.description.slice(0, 130) : "NONE"}`);
    console.log(`  amenities(${amen.length}): ${amen.slice(0, 5).join(", ") || "NONE"}`);
    console.log(`  extras: ${extras ? JSON.stringify(extras).slice(0, 120) : "NONE"}`);
    if (l.brokerName) console.log(`  broker: ${l.brokerName}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

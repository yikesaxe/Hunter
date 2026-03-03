// scripts/checkListingsAnalysis.ts — combined listing + analysis dump
import "dotenv/config";
import { prisma } from "../lib/db.js";

async function main() {
  const listings = await prisma.normalizedListing.findMany({
    select: {
      source: true, address: true, beds: true, baths: true, sqft: true,
      rentGross: true, description: true, amenities: true, scrapedExtras: true,
      analysis: { select: { summary: true, priceTier: true, redFlags: true, brokerSpeak: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Total: ${listings.length} listings, ${listings.filter(l => l.analysis).length} analyzed\n`);

  for (const l of listings) {
    const amen: string[] = (() => { try { return JSON.parse(l.amenities); } catch { return []; } })();
    const extras = l.scrapedExtras as Record<string, unknown> | null;
    const a = l.analysis;
    console.log(`═══ [${l.source}] ${l.address ?? "?"} ══════════════════`);
    console.log(`    ${l.beds ?? "?"}BR ${l.baths ?? "?"}ba${l.sqft ? ` ${l.sqft}sqft` : ""} | $${l.rentGross ?? "?"}`);
    console.log(`    desc(${l.description?.length ?? 0}): ${l.description?.slice(0, 150) ?? "NONE"}`);
    console.log(`    amenities(${amen.length}): ${amen.slice(0, 4).join(" | ") || "none"}`);
    if (extras && Object.keys(extras).length > 0) {
      const transit = (extras.transit as {name:string}[] | undefined)?.slice(0,2).map(t=>t.name).join("; ");
      if (transit) console.log(`    transit: ${transit}`);
    }
    if (a) {
      console.log(`    ▶ [${a.priceTier}] ${a.summary}`);
      if ((a.redFlags as string[])?.length) console.log(`    ⚑ ${(a.redFlags as string[]).slice(0,2).join(" | ")}`);
    } else {
      console.log(`    ▶ no analysis yet`);
    }
    console.log();
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());

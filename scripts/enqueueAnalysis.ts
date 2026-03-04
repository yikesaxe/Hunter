// scripts/enqueueAnalysis.ts
// Manually enqueue analyze-text + analyze-photos for all active listings.
import "dotenv/config";
import { prisma } from "../lib/db.js";
import { getAnalyzeTextQueue, getAnalyzePhotosQueue } from "../scraper/src/queues.js";

async function main() {
  const listings = await prisma.normalizedListing.findMany({
    where: { status: "active" },
    select: { id: true, photos: true, address: true },
  });

  console.log(`Enqueuing analysis for ${listings.length} listings…`);

  for (const l of listings) {
    await getAnalyzeTextQueue().add("analyze-text", { listingId: l.id });

    const photos: string[] = (() => { try { return JSON.parse(l.photos ?? "[]"); } catch { return []; } })();
    if (photos.length > 0) {
      await getAnalyzePhotosQueue().add("analyze-photos", { listingId: l.id });
    }
    console.log(`  ${l.address ?? l.id} (${photos.length} photo(s))`);
  }

  await getAnalyzeTextQueue().close();
  await getAnalyzePhotosQueue().close();
  await prisma.$disconnect();
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });

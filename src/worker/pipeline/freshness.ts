import { prisma } from "@/lib/prisma";

/**
 * Update activeState on all canonical units based on lastSeenAt:
 *  - <= 7 days ago: "active"
 *  - 8–14 days ago: "unknown"
 *  - > 14 days ago: "stale"
 *
 * Runs as a single batch of 3 UPDATE queries for efficiency.
 */
export async function updateFreshness(): Promise<void> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Mark active: lastSeenAt within 7 days
  const activeResult = await prisma.canonicalUnit.updateMany({
    where: {
      lastSeenAt: { gte: sevenDaysAgo },
      activeState: { not: "active" },
    },
    data: { activeState: "active" },
  });

  // Mark unknown: lastSeenAt between 8-14 days
  const unknownResult = await prisma.canonicalUnit.updateMany({
    where: {
      lastSeenAt: { lt: sevenDaysAgo, gte: fourteenDaysAgo },
      activeState: { not: "unknown" },
    },
    data: { activeState: "unknown" },
  });

  // Mark stale: lastSeenAt older than 14 days
  const staleResult = await prisma.canonicalUnit.updateMany({
    where: {
      lastSeenAt: { lt: fourteenDaysAgo },
      activeState: { not: "stale" },
    },
    data: { activeState: "stale" },
  });

  console.log(
    `[freshness] Updated: ${activeResult.count} active, ${unknownResult.count} unknown, ${staleResult.count} stale`
  );
}

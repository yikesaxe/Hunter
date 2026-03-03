import "dotenv/config";
import { prisma } from "../lib/db.js";
async function main() {
  const rows = await prisma.normalizedListing.findMany({
    where: { brokerName: { not: null } },
    take: 3,
    select: { source: true, address: true, brokerName: true, description: true },
  });
  console.log("Listings with brokerName:", rows.length);
  for (const r of rows) console.log(r);
  const total = await prisma.normalizedListing.count();
  console.log("Total listings:", total);
}
main().catch(console.error).finally(() => prisma.$disconnect());

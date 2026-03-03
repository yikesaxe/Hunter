import "dotenv/config";
import { PrismaClient } from "../node_modules/.prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as never) as any;

async function main() {
  const count = await prisma.listingAnalysis.count();
  const sample = await prisma.listingAnalysis.findMany({
    where: { brokerSpeak: { not: [] } },
    take: 3,
    select: { summary: true, priceTier: true, redFlags: true, brokerSpeak: true, neighborhoodMedian: true },
  });
  console.log("Total analyses in DB:", count);
  sample.forEach((a: any) => {
    console.log("---");
    console.log("Tier:", a.priceTier, "| Median:", a.neighborhoodMedian);
    console.log("Summary:", a.summary);
    console.log("RedFlags:", JSON.stringify(a.redFlags));
    console.log("BrokerSpeak:", JSON.stringify(a.brokerSpeak, null, 2));
  });
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });

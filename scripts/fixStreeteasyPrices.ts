import "dotenv/config";
import { prisma } from "../lib/db.js";

async function main() {
  const result = await prisma.normalizedListing.deleteMany({
    where: {
      source: "streeteasy",
      OR: [
        { rentGross: { lt: 800 } },
        { rentGross: null },
      ],
    },
  });
  console.log(`✅ Deleted ${result.count} StreetEasy listings with price < $800 or price is NULL`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

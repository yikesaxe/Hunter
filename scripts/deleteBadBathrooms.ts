import "dotenv/config";
import { prisma } from "../lib/db.js";

async function main() {
  const result = await prisma.normalizedListing.deleteMany({
    where: {
      baths: { gt: 100 },
    },
  });
  console.log(`✅ Deleted ${result.count} listings with bathrooms > 100`);
}

main()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

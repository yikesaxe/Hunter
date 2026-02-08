/**
 * Quick script to verify both adapters can discover and parse fixtures.
 * Run: npx tsx scripts/test-adapters.ts
 */
import { mockStreetEasyAdapter } from "../src/worker/adapters/mockStreetEasy";
import { mockCraigslistAdapter } from "../src/worker/adapters/mockCraigslist";
import { SourceAdapter } from "../src/worker/adapters/SourceAdapter";

async function testAdapter(adapter: SourceAdapter) {
  console.log(`\n=== Testing adapter: ${adapter.name} ===`);

  const listings = await adapter.discover();
  console.log(`Discovered ${listings.length} listings:`);
  for (const listing of listings) {
    console.log(`  - ${listing.sourceListingId}: ${listing.url}`);
  }

  // Parse first listing as a sample
  if (listings.length > 0) {
    const first = listings[0];
    const fetched = await adapter.fetch(first.url);
    console.log(`\nFetched ${first.url} -> status ${fetched.httpStatus}`);

    const parsed = await adapter.parse(fetched.content, {
      url: first.url,
      sourceListingId: first.sourceListingId,
    });
    console.log("Parsed result:");
    console.log(JSON.stringify(parsed, null, 2));
  }
}

async function main() {
  await testAdapter(mockStreetEasyAdapter);
  await testAdapter(mockCraigslistAdapter);
  console.log("\nAll adapters tested successfully.");
}

main().catch(console.error);

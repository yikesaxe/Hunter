/**
 * Quick test: fetch a public Leasebreak page and print status + content length.
 * Run: npx tsx scripts/test-fetch.ts
 */
import { fetchWithPolicy } from "../src/worker/http/fetchWithPolicy";

async function main() {
  const url = "https://www.leasebreak.com/";
  console.log(`Fetching ${url}...`);

  const result = await fetchWithPolicy(url);
  console.log(`Status: ${result.httpStatus}`);
  console.log(`Final URL: ${result.finalUrl}`);
  console.log(`Content length: ${result.content.length} chars`);
  console.log(`First 200 chars:\n${result.content.slice(0, 200)}`);
}

main().catch(console.error);

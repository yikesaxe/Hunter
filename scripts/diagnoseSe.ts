import "dotenv/config";
import { fetchPage } from "../scraper/src/fetchPage.js";
import { extractListingUrls } from "../scraper/src/parseListing.js";

async function main() {
  const url = "https://streeteasy.com/for-rent/manhattan";
  console.log("Fetching:", url);
  const result = await fetchPage(url, false);
  console.log("Status:", result.statusCode);
  console.log("HTML length:", result.html.length);

  const lower = result.html.toLowerCase();
  console.log("Has /rental/ links:", lower.includes("/rental/"));
  console.log("Has /building/ links:", lower.includes("/building/"));

  const urls = extractListingUrls(result.html, url);
  console.log("Extracted URLs:", urls.length);
  if (urls.length > 0) {
    console.log("First 5:", urls.slice(0, 5));
  } else {
    const idx = lower.indexOf("/rental/");
    if (idx > 0) {
      console.log("rental context:", result.html.slice(Math.max(0, idx - 50), idx + 100));
    } else {
      console.log("No /rental/ found. First 800 chars of HTML:");
      console.log(result.html.slice(0, 800));
    }
  }
}

main().catch(console.error);

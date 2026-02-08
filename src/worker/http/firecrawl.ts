/**
 * Firecrawl API integration for fetching pages that block direct scraping.
 * Used for StreetEasy where direct HTTP fetch is blocked by bot detection.
 */

const FIRECRAWL_API_URL = "https://api.firecrawl.dev/v1/scrape";

export interface FirecrawlResult {
  html: string;
  metadata: FirecrawlMetadata;
}

export interface FirecrawlMetadata {
  title?: string;
  description?: string;
  "og:title"?: string;
  "og:description"?: string;
  "og:image"?: string | string[];
  "geo.position"?: string;
  ICBM?: string;
  [key: string]: unknown;
}

/**
 * Fetch a page via Firecrawl API.
 * Requires FIRECRAWL_API_KEY env var or passed directly.
 */
export async function fetchViaFirecrawl(
  url: string,
  apiKey?: string
): Promise<FirecrawlResult> {
  const key = apiKey || process.env.FIRECRAWL_API_KEY;
  if (!key) {
    throw new Error(
      "FIRECRAWL_API_KEY not set. Add it to .env or pass it directly."
    );
  }

  console.log(`[firecrawl] Fetching ${url}`);

  const response = await fetch(FIRECRAWL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      url,
      formats: ["html"],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `[firecrawl] API error ${response.status}: ${body.slice(0, 200)}`
    );
  }

  const data = await response.json();

  if (!data.success) {
    throw new Error(
      `[firecrawl] Scrape failed: ${JSON.stringify(data).slice(0, 200)}`
    );
  }

  return {
    html: data.data.html || "",
    metadata: data.data.metadata || {},
  };
}

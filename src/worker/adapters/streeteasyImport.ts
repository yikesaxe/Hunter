/**
 * StreetEasy Import Adapter — parse-only (no crawling).
 *
 * StreetEasy's robots.txt disallows automated access to /rental/* paths.
 * This adapter only parses HTML that a user provides (via paste or file drop).
 * It does NOT implement discover() or fetch() for automated crawling.
 */
import { NormalizedListingInput } from "@/lib/domain/types";
import { loadHtml } from "../html/cheerio";
import { parseText, parseMoney, parseNumber, parseAllAttr } from "../html/parse";

/**
 * Normalize borough names from StreetEasy URL paths or text.
 */
function normalizeBoroughName(raw: string): string {
  const map: Record<string, string> = {
    manhattan: "Manhattan",
    brooklyn: "Brooklyn",
    queens: "Queens",
    bronx: "Bronx",
    "staten-island": "Staten Island",
    "staten island": "Staten Island",
  };
  return map[raw.toLowerCase().trim()] ?? raw.trim();
}

/**
 * Try to extract a listing ID from a StreetEasy URL.
 * e.g. https://streeteasy.com/rental/1234567 -> "1234567"
 */
export function extractListingId(url: string): string | undefined {
  const match = url.match(/\/rental\/(\d+)/);
  return match ? match[1] : undefined;
}

/**
 * Parse StreetEasy page source HTML into a NormalizedListingInput.
 * Best-effort: tries multiple selector strategies since SE HTML varies.
 */
export function parseStreetEasyHtml(
  html: string,
  meta: { url: string; sourceListingId?: string }
): NormalizedListingInput & { title: string } {
  const $ = loadHtml(html);

  // --- Title / Address ---
  // Try multiple strategies
  let title =
    parseText($, '[data-testid="listing-title"]') ||
    parseText($, ".listing-title h1") ||
    parseText($, "h1") ||
    parseText($, "title")?.replace(/\s*\|.*$/, "")?.replace(/\s*-\s*StreetEasy.*$/i, "") ||
    "Unknown";

  // Often the title IS the address on StreetEasy
  let address = title;

  // Try to extract a more specific address
  const specificAddress =
    parseText($, '[data-testid="listing-address"]') ||
    parseText($, ".listing-title__address") ||
    parseText($, ".building-title a") ||
    parseText($, '[class*="DetailAddress"]');
  if (specificAddress) {
    address = specificAddress;
    if (!title || title === "Unknown") title = specificAddress;
  }

  // --- Unit ---
  let unit: string | null =
    parseText($, '[data-testid="listing-unit"]') ||
    parseText($, ".listing-title__unit");
  // Sometimes the unit is in the title like "Unit 3A at 123 Main St"
  if (!unit && title) {
    const unitMatch = title.match(/(?:unit|apt|#)\s*(\w+)/i);
    if (unitMatch) unit = unitMatch[1];
  }

  // --- Neighborhood / Borough ---
  let neighborhood: string | null = null;
  let borough: string | null = null;

  // Try breadcrumbs
  const breadcrumbs = $("nav a, .Breadcrumb a, [class*='breadcrumb'] a, [class*='Breadcrumb'] a")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter((t) => t.length > 0 && t.length < 50);

  if (breadcrumbs.length >= 2) {
    // Typically: Home > Borough > Neighborhood > ...
    for (const crumb of breadcrumbs) {
      const lower = crumb.toLowerCase();
      if (["manhattan", "brooklyn", "queens", "bronx", "staten island"].includes(lower)) {
        borough = normalizeBoroughName(crumb);
      } else if (!["home", "nyc", "new york", "rentals", "for rent"].includes(lower) && !borough) {
        // Could be neighborhood
      }
    }
  }

  // Try from URL
  if (!borough) {
    const urlMatch = meta.url.match(
      /streeteasy\.com\/(?:rental|building)\/[^/]+\/(manhattan|brooklyn|queens|bronx|staten-island)/i
    );
    if (urlMatch) borough = normalizeBoroughName(urlMatch[1]);
  }

  // Try from meta tags or structured data
  const neighborhoodText =
    parseText($, '[data-testid="listing-neighborhood"]') ||
    parseText($, ".listing-neighborhood") ||
    parseText($, '[class*="neighborhood"]');
  if (neighborhoodText) {
    const parts = neighborhoodText.split(",").map((s) => s.trim());
    if (parts.length >= 2) {
      neighborhood = parts[0];
      if (!borough) borough = normalizeBoroughName(parts[parts.length - 1]);
    } else {
      neighborhood = parts[0];
    }
  }

  // --- Rent ---
  let rentGross: number | null = null;

  // Try specific selectors
  const priceText =
    parseText($, '[data-testid="price"]') ||
    parseText($, ".price") ||
    parseText($, '[class*="Price"]') ||
    parseText($, ".details_info_price") ||
    parseText($, ".price--rental");
  rentGross = parseMoney(priceText);

  // Fallback: look for a prominent dollar amount
  if (rentGross === null) {
    const allText = $.text();
    const priceMatch = allText.match(/\$\s*([\d,]+)\s*(?:\/\s*mo|per\s*month)?/);
    if (priceMatch) {
      rentGross = parseMoney(`$${priceMatch[1]}`);
    }
  }

  // --- Net Effective Rent ---
  let rentNetEffective: number | null = null;
  const netEffectiveText =
    parseText($, '[class*="net-effective"]') ||
    parseText($, '[class*="NetEffective"]');
  if (netEffectiveText) {
    rentNetEffective = parseMoney(netEffectiveText);
  }

  // --- Bedrooms / Bathrooms ---
  let bedrooms: number | null = null;
  let bathrooms: number | null = null;

  // Try data attributes and common selectors
  const bedsText =
    parseText($, '[data-testid="beds"]') ||
    parseText($, ".detail_cell--beds") ||
    parseText($, '[class*="bed"]');
  const bathsText =
    parseText($, '[data-testid="baths"]') ||
    parseText($, ".detail_cell--baths") ||
    parseText($, '[class*="bath"]');

  if (bedsText) {
    if (/studio/i.test(bedsText)) {
      bedrooms = 0;
    } else {
      bedrooms = parseNumber(bedsText.replace(/[^0-9.]/g, ""));
    }
  }
  if (bathsText) {
    bathrooms = parseNumber(bathsText.replace(/[^0-9.]/g, ""));
  }

  // Fallback: try to find "X bed / Y bath" pattern in text
  if (bedrooms === null) {
    const bedMatch = $.text().match(/(\d+)\s*(?:bed(?:room)?s?|br)/i);
    if (bedMatch) bedrooms = parseNumber(bedMatch[1]);
    else if (/studio/i.test($.text().slice(0, 2000))) bedrooms = 0;
  }
  if (bathrooms === null) {
    const bathMatch = $.text().match(/([\d.]+)\s*(?:bath(?:room)?s?|ba)/i);
    if (bathMatch) bathrooms = parseNumber(bathMatch[1]);
  }

  // --- Broker Fee ---
  let brokerFee: boolean | null = null;
  const feeText = $.text().toLowerCase();
  if (feeText.includes("no fee") || feeText.includes("no broker fee")) {
    brokerFee = false;
  } else if (feeText.includes("broker fee") || feeText.includes("with fee")) {
    brokerFee = true;
  }

  // --- Description ---
  const description =
    parseText($, '[data-testid="listing-description"]') ||
    parseText($, ".listing-description") ||
    parseText($, '[class*="Description"]') ||
    parseText($, ".description") ||
    null;

  // --- Images ---
  const images: string[] = [];
  // Try og:image meta tags first
  $('meta[property="og:image"]').each((_, el) => {
    const content = $(el).attr("content");
    if (content) images.push(content);
  });
  // Try img tags with streeteasy image URLs
  if (images.length === 0) {
    $("img").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || "";
      if (
        (src.includes("streeteasy") || src.includes("imgix")) &&
        !src.includes("logo") &&
        !src.includes("icon")
      ) {
        images.push(src);
      }
    });
  }

  return {
    source: "streeteasy",
    sourceUrl: meta.url,
    title,
    description,
    address,
    unit,
    neighborhood,
    borough,
    lat: null,
    lng: null,
    rentGross,
    rentNetEffective,
    bedrooms,
    bathrooms,
    brokerFee,
    leaseTermMonths: null,
    moveInCostNotes: null,
    petPolicy: null,
    laundry: null,
    elevator: null,
    doorman: null,
    images,
  };
}

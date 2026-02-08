/**
 * StreetEasy Import Adapter — parse-only (no direct crawling).
 *
 * StreetEasy's robots.txt disallows automated access to /rental/* paths.
 * This adapter parses HTML that arrives via:
 *   1. Firecrawl API (user provides URL, we fetch via Firecrawl)
 *   2. User paste (user copies page source manually)
 *   3. Chrome extension (captures DOM from user's browser)
 *
 * It does NOT directly fetch from streeteasy.com.
 */
import { NormalizedListingInput } from "@/lib/domain/types";
import { loadHtml } from "../html/cheerio";
import { parseMoney, parseNumber } from "../html/parse";
import { FirecrawlMetadata } from "../http/firecrawl";

/**
 * Try to extract a listing ID from a StreetEasy URL.
 * e.g. https://streeteasy.com/building/350-east-52nd-street-new_york/2g -> "350-east-52nd-street-new_york/2g"
 */
export function extractListingId(url: string): string | undefined {
  const match = url.match(/streeteasy\.com\/(?:building|rental)\/(.+?)(?:\?|$)/);
  return match ? match[1] : undefined;
}

/**
 * Parse StreetEasy page HTML into a NormalizedListingInput.
 * Tested against real Firecrawl-captured HTML from Feb 2026.
 *
 * @param firecrawlMeta - optional metadata from Firecrawl API response
 *   (has richer data than the HTML alone: og:title, geo coords, images)
 */
export function parseStreetEasyHtml(
  html: string,
  meta: { url: string; sourceListingId?: string },
  firecrawlMeta?: FirecrawlMetadata
): NormalizedListingInput & { title: string } {
  const $ = loadHtml(html);

  // --- Address / Title ---
  // H1 contains "350 East 52nd Street #2G"
  // Firecrawl's HTML often has empty <title>, so use metadata title as fallback
  const fcTitleStr = typeof (firecrawlMeta?.title || firecrawlMeta?.["og:title"]) === "string"
    ? ((firecrawlMeta?.title || firecrawlMeta?.["og:title"]) as string)
      .replace(/\s*\|.*$/, "")
      .replace(/\s*in\s+\w.*$/, "")
    : "";

  let title =
    $("h1").first().text().trim() ||
    $("title").text().trim().replace(/\s*\|.*$/, "").replace(/\s*in\s+.*$/, "") ||
    fcTitleStr ||
    "Unknown";

  // Parse address and unit from H1 like "350 East 52nd Street #2G"
  let address: string | null = title;
  let unit: string | null = null;
  const unitMatch = title.match(/\s*#(\w+)\s*$/);
  if (unitMatch) {
    unit = unitMatch[1];
    address = title.replace(/\s*#\w+\s*$/, "").trim();
  }

  // More specific address from building section
  const buildingAddr = $(".AboutBuildingSection_address__TdYEX, [class*='AboutBuildingSection_address']")
    .first()
    .text()
    .trim();
  if (buildingAddr && buildingAddr.length > 5) {
    // This has full address with city/state: "350 East 52nd Street, New York, NY 10022"
    // Keep just the street address part
    const streetPart = buildingAddr.split(",")[0].trim();
    if (streetPart) address = streetPart;
  }

  // Pre-compute full page text for searches
  const pageText = $.text().toLowerCase();

  // --- Neighborhood / Borough ---
  let neighborhood: string | null = null;
  let borough: string | null = null;

  // Try Firecrawl og:title first: "350 East 52nd Street #2G in Turtle Bay, Manhattan | StreetEasy"
  const ogTitle = firecrawlMeta?.["og:title"] || firecrawlMeta?.title || "";
  const fcTitle = typeof ogTitle === "string" ? ogTitle : "";
  const locationMatch = fcTitle.match(/in\s+([^,|]+),\s*(Manhattan|Brooklyn|Queens|Bronx|Staten Island)/i);
  if (locationMatch) {
    neighborhood = locationMatch[1].trim();
    borough = locationMatch[2].trim();
  }

  // Fallback: try title tag from HTML
  if (!neighborhood) {
    const titleTag = $("title").text().trim();
    const htmlLocationMatch = titleTag.match(/in\s+([^,|]+),\s*(Manhattan|Brooklyn|Queens|Bronx|Staten Island)/i);
    if (htmlLocationMatch) {
      neighborhood = htmlLocationMatch[1].trim();
      borough = htmlLocationMatch[2].trim();
    }
  }

  // Fallback: try the neighborhood link in building summary
  if (!neighborhood) {
    const nhLink = $("[class*='BuildingSummaryList_listItem']")
      .first()
      .text()
      .trim();
    if (nhLink && nhLink.length < 40) neighborhood = nhLink;
  }

  // Fallback: try "Explore <Neighborhood>" heading
  if (!neighborhood) {
    $("[class*='ExploreNeigborhoods_heading'], h2").each((_, el) => {
      const text = $(el).text().trim();
      const exploreMatch = text.match(/Explore\s+(.+)/);
      if (exploreMatch && !neighborhood) {
        neighborhood = exploreMatch[1].trim();
      }
    });
  }

  // Fallback: extract borough from page text
  if (!borough) {
    const boroughs = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island"];
    for (const b of boroughs) {
      if (pageText.includes(b.toLowerCase() + " rental")) {
        borough = b;
        break;
      }
    }
  }

  // --- Rent ---
  // Price is in an H4 with PriceInfo_price class
  const priceText = $("[class*='PriceInfo_price']").first().text().trim();
  let rentGross = parseMoney(priceText);

  // Fallback: first prominent dollar amount
  if (rentGross === null) {
    $("h4, h3, h2").each((_, el) => {
      if (rentGross !== null) return;
      const text = $(el).text().trim();
      const amount = parseMoney(text);
      if (amount && amount > 500 && amount < 100000) {
        rentGross = amount;
      }
    });
  }

  // --- Net Effective Rent ---
  let rentNetEffective: number | null = null;
  $("p").each((_, el) => {
    const text = $(el).text().trim();
    if (text.includes("net effective")) {
      rentNetEffective = parseMoney(text);
    }
  });

  // --- Bedrooms / Bathrooms ---
  let bedrooms: number | null = null;
  let bathrooms: number | null = null;

  $("p").each((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    if (text.match(/^\d+\s*bed/)) {
      bedrooms = parseNumber(text.match(/(\d+)/)?.[1] ?? null);
    } else if (text === "studio") {
      bedrooms = 0;
    } else if (text.match(/^\d+\.?\d*\s*bath/)) {
      bathrooms = parseNumber(text.match(/([\d.]+)/)?.[1] ?? null);
    }
  });

  // Fallback from full page text
  if (bedrooms === null) {
    const bedMatch = $.text().match(/(\d+)\s*bed/i);
    if (bedMatch) bedrooms = parseNumber(bedMatch[1]);
    else if (/studio/i.test($.text().slice(0, 3000))) bedrooms = 0;
  }
  if (bathrooms === null) {
    const bathMatch = $.text().match(/([\d.]+)\s*bath/i);
    if (bathMatch) bathrooms = parseNumber(bathMatch[1]);
  }

  // --- Broker Fee ---
  let brokerFee: boolean | null = null;
  if (pageText.includes("can't be charged a broker fee") || pageText.includes("no fee")) {
    brokerFee = false;
  } else if (pageText.includes("broker fee") && !pageText.includes("can't be charged")) {
    brokerFee = true;
  }

  // --- Description ---
  let description: string | null = null;
  // Find the longest paragraph that looks like a listing description
  $("p").each((_, el) => {
    const text = $(el).text().trim();
    if (
      text.length > 100 &&
      !text.includes("Similar Homes") &&
      !text.includes("net effective") &&
      !text.includes("Listing by") &&
      (description === null || text.length > (description?.length || 0))
    ) {
      description = text;
    }
  });

  // --- Geo coordinates ---
  let lat: number | null = null;
  let lng: number | null = null;
  // Prefer Firecrawl metadata (always has it from SE's meta tags)
  const geoStr =
    firecrawlMeta?.["geo.position"] ||
    firecrawlMeta?.ICBM ||
    $('meta[name="geo.position"]').attr("content") ||
    $('meta[name="ICBM"]').attr("content");
  if (typeof geoStr === "string" && geoStr) {
    const [latStr, lngStr] = geoStr.split(/[;,]/).map((s) => s.trim());
    lat = parseFloat(latStr) || null;
    lng = parseFloat(lngStr) || null;
  }

  // --- Images ---
  const images: string[] = [];
  // Prefer Firecrawl metadata og:image (clean array of full URLs)
  const fcImages = firecrawlMeta?.["og:image"];
  if (Array.isArray(fcImages)) {
    images.push(...fcImages);
  } else if (typeof fcImages === "string" && fcImages) {
    images.push(fcImages);
  }
  // Fallback: HTML meta tags
  if (images.length === 0) {
    $('meta[property="og:image"]').each((_, el) => {
      const content = $(el).attr("content");
      if (content) images.push(content);
    });
  }
  // Fallback: img tags
  if (images.length === 0) {
    $("img").each((_, el) => {
      const src = $(el).attr("src") || "";
      if (
        (src.includes("zillowstatic") || src.includes("streeteasy")) &&
        !src.includes("logo") &&
        !src.includes("icon") &&
        !src.includes("avatar")
      ) {
        images.push(src);
      }
    });
  }

  // --- Elevator / Doorman from page text ---
  let elevator: boolean | null = null;
  let doorman: boolean | null = null;
  let laundry: string | null = null;

  if (pageText.includes("elevator")) elevator = true;
  if (pageText.includes("doorman")) doorman = true;
  if (pageText.includes("laundry in building") || pageText.includes("on-site laundry"))
    laundry = "in_building";
  if (pageText.includes("washer/dryer in unit") || pageText.includes("in-unit laundry"))
    laundry = "in_unit";

  return {
    source: "streeteasy",
    sourceUrl: meta.url,
    title,
    description,
    address,
    unit,
    neighborhood,
    borough,
    lat,
    lng,
    rentGross,
    rentNetEffective,
    bedrooms,
    bathrooms,
    brokerFee,
    leaseTermMonths: null,
    moveInCostNotes: null,
    petPolicy: null,
    laundry,
    elevator,
    doorman,
    images,
  };
}

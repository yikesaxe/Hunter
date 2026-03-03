// scraperV2/src/parseListing.ts
// Layered listing parser: site-specific → JSON-LD → meta tags → heuristics.
// Works on any site via generic layers; gets more accurate with site-specific selectors.

import * as cheerio from "cheerio";

export interface ListingData {
  title: string | null;
  address: string | null;
  neighborhood: string | null;
  borough: string | null;
  price: number | null;
  /** Positive = price increased, negative = price dropped (StreetEasy pill). */
  priceDelta: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  description: string | null;
  features: string[];
  photos: string[];
  latitude: number | null;
  longitude: number | null;
  sourceListingId: string | null;
  source: string;
  url: string;
  extractedBy: string[];
  brokerName: string | null;
  /** Transit, schools, pet policy, laundry and other site-specific extras. */
  extras: Record<string, unknown>;
}

/** Cloudflare/challenge pages often parse to this; treat as blocked, not a real listing. */
const CHALLENGE_PHRASES = [
  "performing security verification",
  "just a moment",
  "checking your browser",
  "enable javascript and cookies",
  "access to this page has been denied",
  "your request has been blocked",
  "access denied",
];

export function isChallengePage(listing: ListingData): boolean {
  const t = (listing.title || "").toLowerCase().trim();
  const a = (listing.address || "").toLowerCase().trim();
  const combined = `${t} ${a}`;
  if (!combined) return false;
  const looksLikeChallenge = CHALLENGE_PHRASES.some((p) => combined.includes(p));
  const hasNoRealData = listing.price == null && listing.beds == null && listing.photos.length === 0;
  return looksLikeChallenge && hasNoRealData;
}

// --- Utility ---

export function parseMoney(str: string | null | undefined): number | null {
  if (!str) return null;
  const match = str.match(/\$\s*([\d,]+)/);
  if (!match) return null;
  return parseInt(match[1].replace(/,/g, ""), 10) || null;
}

/** Sanity: bedroom count is typically 0 (studio) through 8. Reject absurd values. */
function saneBeds(value: number): number | null {
  if (typeof value !== "number" || isNaN(value)) return null;
  if (value < 0 || value > 8) return null;
  return value;
}

function getDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return "unknown"; }
}

// --- Source detection ---

export function detectSource(url: string): string {
  const domain = getDomain(url);
  if (domain.includes("leasebreak.com")) return "leasebreak";
  if (domain.includes("streeteasy.com")) return "streeteasy";
  if (domain.includes("zillow.com")) return "zillow";
  if (domain.includes("renthop.com")) return "renthop";
  if (domain.includes("apartments.com")) return "apartments.com";
  return "unknown";
}

// --- Generic layer: JSON-LD ---

function extractFromJsonLd($: cheerio.CheerioAPI, data: ListingData) {
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html();
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const blocks = Array.isArray(parsed) ? parsed : [parsed];

      for (const block of blocks) {
        // Also check @graph arrays
        if (block["@graph"] && Array.isArray(block["@graph"])) {
          blocks.push(...block["@graph"]);
          continue;
        }

        const type = String(block["@type"] || "").toLowerCase();
        if (!type.includes("realestate") && !type.includes("apartment") &&
            !type.includes("residence") && !type.includes("product") &&
            !type.includes("place") && !type.includes("singlefamily") &&
            !type.includes("house")) continue;

        if (!data.title && block.name) data.title = String(block.name);
        if (!data.description && block.description) data.description = String(block.description);

        const addr = block.address;
        if (addr && typeof addr === "object") {
          if (!data.address && addr.streetAddress) data.address = String(addr.streetAddress);
          if (!data.neighborhood && addr.addressLocality) data.neighborhood = String(addr.addressLocality);
        }

        const geo = block.geo;
        if (geo && typeof geo === "object") {
          if (!data.latitude && geo.latitude) data.latitude = Number(geo.latitude);
          if (!data.longitude && geo.longitude) data.longitude = Number(geo.longitude);
        }

        if (!data.price) {
          const offers = block.offers;
          if (offers?.price) data.price = parseInt(String(offers.price), 10) || null;
          if (!data.price && offers?.lowPrice) data.price = parseInt(String(offers.lowPrice), 10) || null;
        }

        // StreetEasy: never let JSON-LD set beds/baths — its structured data can contain
        // price-change amounts in room-count fields. Beds/baths come only from the
        // [data-testid="propertyDetails"] block via extractFromStreetEasy.
        if (data.source !== "streeteasy") {
          if (!data.beds && block.numberOfBedrooms) {
            const v = saneBeds(parseFloat(String(block.numberOfBedrooms)));
            if (v !== null) data.beds = v;
          }
          if (!data.beds && block.numberOfRooms) {
            const v = saneBeds(parseFloat(String(block.numberOfRooms)));
            if (v !== null) data.beds = v;
          }
          if (!data.baths && block.numberOfBathroomsTotal) data.baths = parseFloat(String(block.numberOfBathroomsTotal));
        }

        if (data.photos.length === 0) {
          const img = block.image;
          if (Array.isArray(img)) data.photos = img.map(String);
          else if (typeof img === "string") data.photos = [img];
        }

        data.extractedBy.push("json-ld");
      }
    } catch { /* skip invalid JSON-LD */ }
  });
}

// --- Generic layer: Meta tags ---

function extractFromMetaTags($: cheerio.CheerioAPI, data: ListingData) {
  let found = false;

  if (!data.title) {
    const t = $('meta[property="og:title"]').attr("content") || $("title").text().trim();
    if (t) { data.title = t; found = true; }
  }
  if (!data.description) {
    const d = $('meta[property="og:description"]').attr("content") || $('meta[name="description"]').attr("content");
    if (d) { data.description = d; found = true; }
  }
  if (!data.latitude) {
    const geo = $('meta[name="geo.position"]').attr("content") || $('meta[name="ICBM"]').attr("content");
    if (geo) {
      const [lat, lng] = geo.split(/[;,]/).map((s) => parseFloat(s.trim()));
      if (!isNaN(lat)) { data.latitude = lat; found = true; }
      if (!isNaN(lng)) { data.longitude = lng; found = true; }
    }
  }
  if (data.photos.length === 0) {
    const img = $('meta[property="og:image"]').attr("content");
    if (img) { data.photos = [img]; found = true; }
  }

  if (found) data.extractedBy.push("meta-tags");
}

// --- Generic layer: Text heuristics ---

function extractFromHeuristics($: cheerio.CheerioAPI, data: ListingData) {
  const bodyText = $("body").text();
  let found = false;

  if (!data.price) {
    // Require /mo or /month to avoid grabbing fees, broker costs, or subscription prices
    const match = bodyText.match(/\$\s*([\d,]+)\s*\/\s*(?:mo|month|monthly)\b/i);
    if (match) {
      const parsed = parseMoney(`$${match[1]}`);
      // Sanity floor: NYC rents are almost never below $800
      if (parsed && parsed >= 800) { data.price = parsed; found = true; }
    }
  }
  // StreetEasy beds/baths must come exclusively from the [data-testid="propertyDetails"] block
  // (handled in extractFromStreetEasy). Body-text heuristics are too broad — the price-drop
  // pill amount or other dollar figures can appear before the real count in the text stream.
  if (!data.beds && data.source !== "streeteasy") {
    const match = bodyText.match(/(\d+(?:\.\d+)?)\s*(?:bed(?:room)?s?|BR)\b/i);
    if (match) {
      const v = saneBeds(parseFloat(match[1]));
      if (v !== null) { data.beds = v; found = true; }
    }
    if (!data.beds && /\bstudio\b/i.test(bodyText)) { data.beds = 0; found = true; }
  }
  if (!data.baths && data.source !== "streeteasy") {
    const match = bodyText.match(/(?<!\$)(\d+(?:\.\d+)?)\s*(?:bath(?:room)?s?|BA)\b/i);
    if (match) {
      const v = parseFloat(match[1]);
      if (!isNaN(v) && v >= 0 && v <= 10) { data.baths = v; found = true; }
    }
  }
  if (!data.sqft) {
    const match = bodyText.match(/([\d,]+)\s*(?:sq\.?\s*ft\.?|sqft|square feet)/i);
    if (match) {
      const val = parseInt(match[1].replace(/,/g, ""), 10);
      if (val > 50 && val < 50000) { data.sqft = val; found = true; }
    }
  }

  if (found) data.extractedBy.push("heuristics");
}

// ==========================================================================
// Site-specific selectors
// ==========================================================================

// --- Leasebreak ---

function extractFromLeasebreak($: cheerio.CheerioAPI, url: string, data: ListingData) {
  if (!url.includes("leasebreak.com")) return;
  let found = false;

  if (!data.address) {
    const addr = $("h2").first().text().trim();
    if (addr) { data.address = addr; data.title = data.title || addr; found = true; }
  }
  if (!data.neighborhood) {
    const loc = $(".title-detail-apartments-text").first().text().trim();
    if (loc) {
      const parts = loc.split(",").map((s) => s.trim());
      if (parts.length >= 2) { data.neighborhood = parts[0]; data.borough = parts[1]; }
      else if (parts.length === 1) { data.neighborhood = parts[0]; }
      found = true;
    }
  }
  if (!data.beds || !data.baths) {
    $(".title-icon").each((_, el) => {
      const label = $(el).text().trim().toLowerCase();
      const value = $(el).closest("div").find(".nums-icon").first().text().trim();
      if (label.includes("bedroom") && !data.beds) {
        const raw = value.toLowerCase().includes("studio") ? 0 : (parseFloat(value) || null);
        const v = raw !== null ? saneBeds(raw) : null;
        if (v !== null) { data.beds = v; found = true; }
      } else if (label.includes("bathroom") && !data.baths) {
        data.baths = parseFloat(value) || null;
        found = true;
      }
    });
  }
  if (!data.price) {
    const rows = $("table").first().find("tr");
    if (rows.length > 1) {
      const cells = rows.eq(1).find("td");
      if (cells.length >= 2) { data.price = parseMoney(cells.eq(1).text()); if (data.price) found = true; }
    }
  }
  if (!data.description) {
    const header = $("h2").filter((_, el) => $(el).text().trim() === "Property Details");
    if (header.length > 0) {
      const parts: string[] = [];
      header.nextAll().each((_, el) => {
        if ($(el).prop("tagName") === "H2") return false;
        const text = $(el).text().trim();
        if (text.length > 0) parts.push(text);
      });
      if (parts.length > 0) { data.description = parts.join("\n").trim(); found = true; }
    }
  }
  if (data.features.length === 0) {
    const header = $("h2").filter((_, el) => $(el).text().trim() === "Features");
    if (header.length > 0) {
      header.nextAll("ul, div").first().find("li, span").each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 0 && text.length < 100) data.features.push(text);
      });
      if (data.features.length > 0) found = true;
    }
  }
  if (data.photos.length === 0) {
    $("img").each((_, el) => {
      const src = $(el).attr("src") || "";
      if (src.includes("images.leasebreak.com") && src.includes("uploads")) data.photos.push(src);
    });
    if (data.photos.length > 0) found = true;
  }
  if (!data.sourceListingId) {
    // Matches both /short-term-rental-details/123/ and /rental-details/123/
    const match = url.match(/(?:short-term-)?rental-details\/(\d+)\//);
    if (match) { data.sourceListingId = match[1]; found = true; }
  }

  if (found) data.extractedBy.push("leasebreak");
}

// --- StreetEasy ---

function extractFromStreetEasy($: cheerio.CheerioAPI, url: string, data: ListingData) {
  if (!url.includes("streeteasy.com")) return;
  let found = false;

  // Source listing ID from URL patterns: /rental/1234567 or /building/name/unit
  if (!data.sourceListingId) {
    const rentalMatch = url.match(/\/rental\/(\d+)/);
    const buildingMatch = url.match(/\/building\/([^/]+)\/([^/?]+)/);
    if (rentalMatch) { data.sourceListingId = rentalMatch[1]; found = true; }
    else if (buildingMatch) { data.sourceListingId = `${buildingMatch[1]}-${buildingMatch[2]}`; found = true; }
  }

  // Address — [data-testid="address"] is the h1 inside homeAddress
  if (!data.address) {
    const a = $('[data-testid="address"]').first().text().trim();
    if (a) { data.address = a; data.title = data.title || a; found = true; }
  }
  if (!data.title) {
    const t = $("h1").first().text().trim();
    if (t) { data.title = t; found = true; }
  }

  // Price — the rent h4 lives inside [data-testid="priceInfo"], NOT in pill children.
  // Select the h4 directly to avoid including the price-change pill's dollar amount.
  if (!data.price) {
    const priceText = $('[data-testid="priceInfo"] h4').first().text().trim();
    if (priceText) {
      const parsed = parseMoney(priceText);
      if (parsed && parsed >= 800) { data.price = parsed; found = true; }
    }
  }

  // Price change pill — [data-testid="pill-priceIncrease"] or [data-testid="pill-priceDrop"]
  // Amount is in a <span> with class Caps_base_LkkqI; direction is encoded in the data-testid.
  // IMPORTANT: remove the pill from the DOM after reading it so its dollar amount can never
  // contaminate the body-text heuristics that later scan for bath/bed counts.
  if (data.priceDelta == null) {
    const dropPill = $('[data-testid="pill-priceDrop"]');
    const incPill  = $('[data-testid="pill-priceIncrease"]');
    if (dropPill.length) {
      const v = parseMoney(dropPill.find('[class*="Caps_base"]').first().text().trim());
      if (v) data.priceDelta = -v;
      dropPill.remove();
    } else if (incPill.length) {
      const v = parseMoney(incPill.find('[class*="Caps_base"]').first().text().trim());
      if (v) data.priceDelta = v;
      incPill.remove();
    }
  }

  // Beds / baths / sqft — scan all <p> tags inside ANY [data-testid="propertyDetails"] block.
  // Skip paragraphs that contain "$" — those are pricing/concession lines ("$3,208/mo",
  // "$235 credit") from a separate details block that StreetEasy also marks with this testid.
  // BED_LINE / BATH_LINE / SQFT_LINE are anchored so only clean "2 beds" / "2 baths" /
  // "933 ft²" text matches — no risk of confusing dollar amounts for room counts.
  const BATH_LINE = /^(\d+(?:\.\d+)?)\s*bath(?:room)?s?$/i;
  const BED_LINE  = /^(\d+)\s*beds?$/i;
  const SQFT_LINE = /^([\d,]+)\s*ft²$/i;

  $('[data-testid="propertyDetails"] p').each((_, el) => {
    const text = $(el).text().trim();
    if (text.includes('$')) return; // skip pricing/concession lines
    if (!data.beds) {
      const m = text.match(BED_LINE);
      if (m) { const v = saneBeds(parseInt(m[1], 10)); if (v !== null) { data.beds = v; found = true; } }
      if (!data.beds && /^studio$/i.test(text)) { data.beds = 0; found = true; }
    }
    if (!data.baths) {
      const m = text.match(BATH_LINE);
      if (m) {
        const v = parseFloat(m[1]);
        if (!isNaN(v) && v >= 0 && v <= 10) { data.baths = v; found = true; }
      }
    }
    if (!data.sqft) {
      const m = text.match(SQFT_LINE);
      if (m) { data.sqft = parseInt(m[1].replace(/,/g, ""), 10); found = true; }
    }
  });

  // Neighborhood — last <a> in [data-testid="buildingSummaryList"] is the neighborhood link
  if (!data.neighborhood) {
    const n = $('[data-testid="buildingSummaryList"] a').last().text().trim();
    if (n) { data.neighborhood = n; found = true; }
  }

  // Description — try testid selectors then fallback containers
  if (!data.description) {
    const descSelectors = [
      '[data-testid="description"] p',
      '[data-testid="building-description"]',
      'section[aria-label="Description"]',
      ".description-full",
      "[class*='Description'] p",
    ];
    for (const sel of descSelectors) {
      const el = $(sel).first();
      if (el.length) {
        const text = el.text().trim();
        if (text.length > 50) { data.description = text; found = true; break; }
      }
    }
  }

  // Amenities — try testid selectors then class-based.
  // StreetEasy (FlareSolverr response): home features in home-features-section, building in building-amenities-section.
  if (data.features.length === 0) {
    // StreetEasy-specific: pull home features first, then building amenities.
    // Each li has a primary <p> label and optional sub-label <p> (e.g. "View" + "City").
    // Use li > p:first-child to get only the primary label and skip sub-labels.
    const homeFeatureSel = '[data-testid="home-features-section"] li > p:first-child';
    const buildingAmenitySel = '[data-testid="building-amenities-section"] li > p:first-child';
    const SKIP_PHRASES = /^no info on\b|^services and facilities$|^wellness and recreation$|^shared outdoor space$/i;

    [homeFeatureSel, buildingAmenitySel].forEach(sel => {
      $(sel).each((_, el) => {
        const text = $(el).text().replace(/<!--.*?-->/g, "").trim();
        if (text.length > 1 && text.length < 80 && !SKIP_PHRASES.test(text)) {
          data.features.push(text);
        }
      });
    });

    // Fallback to generic selectors
    if (data.features.length === 0) {
      const amenitySelectors = [
        '[data-testid="amenities"] li',
        '[class*="AmenitiesGroup"] li',
        ".building-amenities li",
        ".unit-amenities li",
        "[class*='amenities'] li",
      ];
      for (const sel of amenitySelectors) {
        $(sel).each((_, el) => {
          const text = $(el).text().trim();
          if (text.length > 0 && text.length < 100) data.features.push(text);
        });
        if (data.features.length > 0) break;
      }
    }

    if (data.features.length > 0) found = true;
  }

  // Photos
  if (data.photos.length === 0) {
    $("img").each((_, el) => {
      const src = $(el).attr("src") || "";
      if (src.includes("image.streeteasy.com") || src.includes("photos.streeteasy.com")) {
        data.photos.push(src);
      }
    });
    if (data.photos.length > 0) found = true;
  }

  if (found) data.extractedBy.push("streeteasy");
}

// --- Zillow ---

function extractFromZillow($: cheerio.CheerioAPI, url: string, data: ListingData) {
  if (!url.includes("zillow.com")) return;
  let found = false;

  // Zillow embeds listing data as JSON in script tags (preloaded Redux state)
  $("script").each((_, el) => {
    const text = $(el).html() || "";
    // Look for preloaded API data
    if (text.includes('"streetAddress"') || text.includes('"price"')) {
      try {
        // Try to extract address
        if (!data.address) {
          const addrMatch = text.match(/"streetAddress"\s*:\s*"([^"]+)"/);
          if (addrMatch) { data.address = addrMatch[1]; data.title = data.title || addrMatch[1]; found = true; }
        }
        // City / neighborhood
        if (!data.neighborhood) {
          const cityMatch = text.match(/"city"\s*:\s*"([^"]+)"/);
          if (cityMatch) { data.neighborhood = cityMatch[1]; found = true; }
        }
        // Price
        if (!data.price) {
          const priceMatch = text.match(/"price"\s*:\s*(\d+)/);
          if (priceMatch) { data.price = parseInt(priceMatch[1], 10); found = true; }
        }
        // Beds: use "bedrooms" only; Zillow JSON can have multiple blobs, prefer sane value (0-8)
        if (!data.beds) {
          const bedsMatch = text.match(/"bedrooms"\s*:\s*(\d+)/);
          if (bedsMatch) {
            const v = saneBeds(parseInt(bedsMatch[1], 10));
            if (v !== null) { data.beds = v; found = true; }
          }
        }
        // Baths
        if (!data.baths) {
          const bathsMatch = text.match(/"bathrooms"\s*:\s*(\d+(?:\.\d+)?)/);
          if (bathsMatch) { data.baths = parseFloat(bathsMatch[1]); found = true; }
        }
        // Sqft
        if (!data.sqft) {
          const sqftMatch = text.match(/"livingArea"\s*:\s*(\d+)/);
          if (sqftMatch) { data.sqft = parseInt(sqftMatch[1], 10); found = true; }
        }
        // Lat/lng
        if (!data.latitude) {
          const latMatch = text.match(/"latitude"\s*:\s*(-?\d+\.?\d*)/);
          const lngMatch = text.match(/"longitude"\s*:\s*(-?\d+\.?\d*)/);
          if (latMatch) { data.latitude = parseFloat(latMatch[1]); found = true; }
          if (lngMatch) { data.longitude = parseFloat(lngMatch[1]); found = true; }
        }
      } catch { /* skip parse errors */ }
    }
  });

  // Source listing ID from URL
  if (!data.sourceListingId) {
    const match = url.match(/\/(\d+)_zpid/) || url.match(/\/([A-Za-z0-9]+)\/?$/);
    if (match) { data.sourceListingId = match[1]; found = true; }
  }

  // Photos from img tags
  if (data.photos.length === 0) {
    $("img").each((_, el) => {
      const src = $(el).attr("src") || "";
      if (src.includes("photos.zillowstatic.com") || src.includes("maps.googleapis.com/maps/api/staticmap")) {
        if (!src.includes("maps.googleapis")) data.photos.push(src);
      }
    });
    if (data.photos.length > 0) found = true;
  }

  if (found) data.extractedBy.push("zillow");
}

// --- RentHop ---

function extractFromRentHop($: cheerio.CheerioAPI, url: string, data: ListingData) {
  if (!url.includes("renthop.com")) return;
  let found = false;

  // Source listing ID from URL: /listings/address/unit/12345678
  if (!data.sourceListingId) {
    const match = url.match(/\/(\d+)\/?$/);
    if (match) { data.sourceListingId = match[1]; found = true; }
  }

  // Title / address
  if (!data.title) {
    const t = $("h1").first().text().trim();
    if (t) { data.title = t; found = true; }
  }
  if (!data.address) {
    const a = $(".listing-address, h2.address, h1").first().text().trim();
    if (a) { data.address = a; found = true; }
  }

  // Price
  if (!data.price) {
    const p = $(".listing-price, .price, [class*='price']").first().text();
    if (p) { data.price = parseMoney(p); if (data.price) found = true; }
  }

  // Beds / baths — try multiple selector patterns
  if (!data.beds) {
    // Try icon-based layout
    const bedText = $(".icon-bed").closest("div, li, span").text().trim()
      || $("[class*='bed']").first().text().trim();
    if (bedText) {
      const m = bedText.match(/(\d+(?:\.\d+)?)\s*(?:bed(?:room)?s?|BR)\b/i);
      if (m) { const v = saneBeds(parseFloat(m[1])); if (v !== null) { data.beds = v; found = true; } }
      if (!data.beds && /\bstudio\b/i.test(bedText)) { data.beds = 0; found = true; }
    }
    // Try table rows with "Bedroom" label
    if (!data.beds) {
      $("tr").each((_, el) => {
        const cells = $(el).find("td, th");
        if (cells.length >= 2) {
          const label = cells.first().text().trim().toLowerCase();
          const val = cells.eq(1).text().trim();
          if (label.includes("bedroom")) {
            const v = /studio/i.test(val) ? 0 : saneBeds(parseFloat(val));
            if (v !== null) { data.beds = v; found = true; }
          }
        }
      });
    }
  }
  if (!data.baths) {
    const bathText = $(".icon-bath").closest("div, li, span").text().trim()
      || $("[class*='bath']").first().text().trim();
    if (bathText) {
      const m = bathText.match(/(\d+(?:\.\d+)?)\s*(?:bath(?:room)?s?|BA)\b/i);
      if (m) { const v = parseFloat(m[1]); if (!isNaN(v) && v >= 0 && v <= 10) { data.baths = v; found = true; } }
    }
    if (!data.baths) {
      $("tr").each((_, el) => {
        const cells = $(el).find("td, th");
        if (cells.length >= 2) {
          const label = cells.first().text().trim().toLowerCase();
          if (label.includes("bathroom")) {
            const v = parseFloat(cells.eq(1).text().trim());
            if (!isNaN(v) && v >= 0 && v <= 10) { data.baths = v; found = true; }
          }
        }
      });
    }
  }

  // Description — try multiple containers
  if (!data.description) {
    const descSelectors = [
      ".listing-description p",
      ".description-full",
      "section.description",
      "div.description",
      "[class*='description'] p",
    ];
    for (const sel of descSelectors) {
      const el = $(sel).first();
      if (el.length) {
        const text = el.text().trim();
        if (text.length > 50) { data.description = text; found = true; break; }
      }
    }
    // Fallback: any <p> block with >100 chars after a "Description" heading
    if (!data.description) {
      let foundHeading = false;
      $("h2, h3, h4").each((_, el) => {
        if ($(el).text().trim().toLowerCase() === "description") foundHeading = true;
      });
      if (foundHeading) {
        $("p").each((_, el) => {
          if (!data.description) {
            const text = $(el).text().trim();
            if (text.length > 100) { data.description = text; found = true; }
          }
        });
      }
    }
  }

  // Amenities — try checkbox lists and feature lists
  if (data.features.length === 0) {
    const amenitySelectors = [
      ".amenities li",
      ".amenities-list li",
      "ul.features li",
      "[class*='amenities'] li",
    ];
    for (const sel of amenitySelectors) {
      $(sel).each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 0 && text.length < 100) data.features.push(text);
      });
      if (data.features.length > 0) { found = true; break; }
    }
    // RentHop uses checked checkboxes for amenities
    if (data.features.length === 0) {
      $("input[type='checkbox']").each((_, el) => {
        if ($(el).attr("checked") !== undefined || $(el).prop("checked")) {
          const label = $(el).closest("label").text().trim()
            || $(el).next("label").text().trim()
            || $(el).attr("name") || "";
          if (label.length > 0 && label.length < 100) data.features.push(label);
        }
      });
      if (data.features.length > 0) found = true;
    }
  }

  // Transit (stored in extras)
  const transitItems: { name: string; lines?: string; distance?: string }[] = [];
  $(".transit-section li, [class*='transit'] li").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 0 && text.length < 200) transitItems.push({ name: text });
  });
  if (transitItems.length === 0) {
    // Look for sections containing "Transit" or "Subway"
    $("h2, h3, h4").each((_, heading) => {
      const label = $(heading).text().trim().toLowerCase();
      if (label.includes("transit") || label.includes("subway") || label.includes("train")) {
        $(heading).nextAll("ul, ol").first().find("li").each((_, li) => {
          const text = $(li).text().trim();
          if (text.length > 0 && text.length < 200) transitItems.push({ name: text });
        });
      }
    });
  }
  if (transitItems.length > 0) { (data.extras as Record<string, unknown>).transit = transitItems; found = true; }

  // Schools (stored in extras)
  const schoolItems: { name: string; grades?: string; distance?: string }[] = [];
  $(".schools-section li, [class*='school'] li").each((_, el) => {
    const text = $(el).text().trim();
    if (text.length > 0 && text.length < 200) schoolItems.push({ name: text });
  });
  if (schoolItems.length === 0) {
    $("h2, h3, h4").each((_, heading) => {
      const label = $(heading).text().trim().toLowerCase();
      if (label.includes("school")) {
        $(heading).nextAll("ul, ol").first().find("li").each((_, li) => {
          const text = $(li).text().trim();
          if (text.length > 0 && text.length < 200) schoolItems.push({ name: text });
        });
      }
    });
  }
  if (schoolItems.length > 0) { (data.extras as Record<string, unknown>).schools = schoolItems; found = true; }

  // Broker name
  if (!data.brokerName) {
    const broker = $(".agent-name, .broker-name, .listing-contact h3").first().text().trim();
    if (broker) { data.brokerName = broker; found = true; }
  }

  // Neighborhood from location/breadcrumb
  if (!data.neighborhood) {
    const loc = $("[class*='location'], .breadcrumb a").first().text().trim();
    if (loc) {
      const parts = loc.split(",").map((s) => s.trim());
      if (parts.length >= 1) { data.neighborhood = parts[0]; found = true; }
    }
  }

  // Photos
  if (data.photos.length === 0) {
    $("img").each((_, el) => {
      const src = $(el).attr("src") || "";
      if (src.includes("renthopcdn.com") || src.includes("photos.renthop.com")) data.photos.push(src);
    });
    if (data.photos.length > 0) found = true;
  }

  if (found) data.extractedBy.push("renthop");
}

// --- Apartments.com ---

function extractFromApartmentsCom($: cheerio.CheerioAPI, url: string, data: ListingData) {
  if (!url.includes("apartments.com")) return;
  let found = false;

  // Source listing ID from URL
  if (!data.sourceListingId) {
    const match = url.match(/\/([a-z0-9]+)\/?$/);
    if (match) { data.sourceListingId = match[1]; found = true; }
  }

  // Title / address
  if (!data.title) {
    const t = $("h1").first().text().trim() || $('[data-testid="property-title"]').text().trim();
    if (t) { data.title = t; found = true; }
  }
  if (!data.address) {
    const a = $(".propertyAddressContainer, .property-address, h2").first().text().trim();
    if (a) { data.address = a; found = true; }
  }

  // Price
  if (!data.price) {
    const p = $(".rentInfoDetail .rentRollup, .pricingColumn .priceRange, [class*='price']").first().text();
    if (p) { data.price = parseMoney(p); if (data.price) found = true; }
  }

  // Beds / baths
  if (!data.beds) {
    const detail = $(".priceBedRangeInfo, .bed-range, [class*='bed']").first().text();
    if (detail) {
      const match = detail.match(/(\d+)\s*(?:bed|BR)/i);
      if (match) {
        const v = saneBeds(parseFloat(match[1]));
        if (v !== null) { data.beds = v; found = true; }
      }
      if (!data.beds && /studio/i.test(detail)) { data.beds = 0; found = true; }
    }
  }
  if (!data.baths) {
    const detail = $("[class*='bath']").first().text();
    if (detail) {
      const match = detail.match(/(\d+(?:\.\d+)?)\s*(?:bath|BA)/i);
      if (match) { data.baths = parseFloat(match[1]); found = true; }
    }
  }

  // Neighborhood
  if (!data.neighborhood) {
    const n = $(".neighborhoodAddress, .neighborhood, [class*='neighborhood']").first().text().trim();
    if (n) { data.neighborhood = n; found = true; }
  }

  // Photos
  if (data.photos.length === 0) {
    $("img").each((_, el) => {
      const src = $(el).attr("src") || "";
      if (src.includes("apartments.com") && src.includes("images") && !src.includes("logo")) {
        data.photos.push(src);
      }
    });
    if (data.photos.length > 0) found = true;
  }

  if (found) data.extractedBy.push("apartments.com");
}

// ==========================================================================
// Step 6: Index page parsing -- extract listing URLs from search results
// ==========================================================================

export function extractListingUrls(html: string, url: string): string[] {
  const $ = cheerio.load(html);
  const source = detectSource(url);
  const seen = new Set<string>();
  const results: string[] = [];

  function addUrl(href: string) {
    try {
      const u = new URL(href, url);
      u.hash = "";
      u.search = "";
      const normalized = u.toString().replace(/\/$/, "") || u.toString();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        results.push(normalized);
      }
    } catch { /* skip invalid URLs */ }
  }

  if (source === "leasebreak") {
    // Leasebreak listing URLs: /short-term-rental-details/{id}/{slug} or /rental-details/{id}/{slug}
    // Accept both patterns in case the site changed its URL structure.
    $('a[href*="rental-details/"]').each((_, el) => {
      const href = $(el).attr("href");
      if (href && /\/(short-term-)?rental-details\/\d+\//.test(href)) addUrl(href);
    });
  } else if (source === "streeteasy") {
    // StreetEasy: /rental/{id} or /building/{name}/{unit}
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (/\/rental\/\d+/.test(href) || /\/building\/[^/]+\/[^/?]+/.test(href)) addUrl(href);
    });
  } else if (source === "zillow") {
    // Zillow: /homedetails/{address}/{zpid}_zpid/ or /apartments/{city}/{name}/{id}/
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (/\/homedetails\//.test(href) || /\/apartments\/[^/]+\/[^/]+\/[A-Za-z0-9]+\/?$/.test(href)) addUrl(href);
    });
  } else if (source === "renthop") {
    // RentHop: /listings/{address}/{unit}/{id}
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (/\/listings\/[^/]+\/[^/]+\/\d+/.test(href)) addUrl(href);
    });
  } else if (source === "apartments.com") {
    // Apartments.com: /{address-slug}/{id}/
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (/apartments\.com\/[^/]+-[^/]+\/[a-z0-9]+\/?$/.test(href)) addUrl(href);
    });
  } else {
    // Generic: grab any link that looks like a listing detail page
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      if (/\/(rental|listing|apartment|property|detail)/i.test(href) &&
          !/\/(search|filter|login|signup|api)/i.test(href)) addUrl(href);
    });
  }

  return results;
}

// ==========================================================================
// Master parser
// ==========================================================================

export function parseListing(html: string, url: string): ListingData {
  const $ = cheerio.load(html);
  const source = detectSource(url);

  const data: ListingData = {
    title: null, address: null, neighborhood: null, borough: null,
    price: null, priceDelta: null, beds: null, baths: null, sqft: null,
    description: null, features: [], photos: [],
    latitude: null, longitude: null, sourceListingId: null,
    brokerName: null, source, url, extractedBy: [], extras: {},
  };

  // Site-specific selectors first (most accurate when available)
  extractFromLeasebreak($, url, data);
  extractFromStreetEasy($, url, data);
  extractFromZillow($, url, data);
  extractFromRentHop($, url, data);
  extractFromApartmentsCom($, url, data);

  // Generic layers fill in anything still missing
  extractFromJsonLd($, data);
  extractFromMetaTags($, data);
  extractFromHeuristics($, data);

  // Sanity: NYC rents below $800 are almost certainly a mis-parse (fees, subscriptions, etc.)
  if (data.price !== null && data.price < 800) {
    data.price = null;
  }

  // StreetEasy: reject beds/baths that are clearly from price pills or wrong block
  if (data.source === "streeteasy") {
    if (data.baths != null && (data.baths < 0 || data.baths > 10)) data.baths = null;
    if (data.beds != null && saneBeds(data.beds) === null) data.beds = null;
  }

  return data;
}

// ==========================================================================
// Pagination
// ==========================================================================

/**
 * Extract the "next page" URL from a search results page, or null if there
 * is no next page (or the site doesn't support link-based pagination).
 *
 * Called by crawlIndex after each page fetch to decide whether to continue.
 */
export function extractNextPageUrl(html: string, currentUrl: string): string | null {
  const $ = cheerio.load(html);
  const source = detectSource(currentUrl);

  // Helper: resolve + return a valid absolute URL, or null
  function resolve(href: string | undefined): string | null {
    if (!href) return null;
    try {
      const u = new URL(href, currentUrl);
      u.hash = "";
      return u.toString();
    } catch {
      return null;
    }
  }

  // 1. Standard rel="next" link — works for many sites
  const relNext = $('a[rel="next"], link[rel="next"]').first().attr("href");
  if (relNext) return resolve(relNext);

  if (source === "streeteasy") {
    // StreetEasy uses ?page=N query param; next-page link has class containing "next"
    const link = $('a[class*="next"], a[data-testid*="next"]').first().attr("href");
    if (link) return resolve(link);

    // Fallback: URL-based page increment.
    // The crawlIndex stops naturally when a page returns 0 listing URLs.
    try {
      const u = new URL(currentUrl);
      const page = parseInt(u.searchParams.get("page") ?? "1", 10);
      u.searchParams.set("page", String(page + 1));
      return u.toString();
    } catch {
      return null;
    }
  }

  if (source === "renthop") {
    // RentHop uses ?page=N
    const link = $('a[class*="next"], a:contains("Next")').first().attr("href");
    if (link) return resolve(link);
    return null;
  }

  if (source === "zillow") {
    // Zillow uses JSON-encoded pagination in searchQueryState — too complex to increment here.
    // The crawlIndex worker handles Zillow pagination via the currentPage field in state.
    return null;
  }

  if (source === "leasebreak") {
    // LeaseBreak typically has a "next" link or page numbers
    const link = $('a:contains("Next"), a[class*="next"]').first().attr("href");
    if (link) return resolve(link);
    return null;
  }

  // Generic: look for common "next page" patterns
  const generic = $(
    'a:contains("Next"), a[aria-label="Next page"], a[class*="pagination-next"]'
  ).first().attr("href");
  return resolve(generic);
}

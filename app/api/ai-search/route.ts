import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createHash, randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { getCrawlQueue } from "@/lib/queue";
import { scoreListing } from "@/lib/recs/score";
import type { PrefsForScoring, ListingForScoring } from "@/lib/recs/types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Rate limiting (in-memory, per IP) ────────────────────────────────────────
// Allows 10 requests per IP per 5 minutes. Resets per window.
const RL_WINDOW_MS = 5 * 60 * 1000;
const RL_MAX = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RL_WINDOW_MS });
    return true;
  }
  if (entry.count >= RL_MAX) return false;
  entry.count++;
  return true;
}

// ── Canonical NYC neighborhood list ──────────────────────────────────────────
// Maps display names → StreetEasy URL slugs.
// Haiku is instructed to return only names from this list.
// buildStreetEasySearchUrl looks up slugs here; unknown names fall back to toSlug().

const NYC_NEIGHBORHOODS: Record<string, string> = {
  // Manhattan — Upper
  "Inwood": "inwood",
  "Washington Heights": "washington-heights",
  "Hudson Heights": "hudson-heights",
  "Fort George": "fort-george",
  "Hamilton Heights": "hamilton-heights",
  "Manhattanville": "manhattanville",
  "Morningside Heights": "morningside-heights",
  "Harlem": "harlem",
  "East Harlem": "east-harlem",
  "Upper West Side": "upper-west-side",
  "Upper East Side": "upper-east-side",
  "Yorkville": "yorkville",
  "Carnegie Hill": "carnegie-hill",
  "Lenox Hill": "lenox-hill",
  // Manhattan — Midtown
  "Hell's Kitchen": "hells-kitchen",
  "Midtown West": "midtown-west",
  "Midtown East": "midtown-east",
  "Midtown": "midtown",
  "Murray Hill": "murray-hill",
  "Kips Bay": "kips-bay",
  "Sutton Place": "sutton-place",
  "Tudor City": "tudor-city",
  // Manhattan — Downtown
  "Chelsea": "chelsea",
  "Flatiron": "flatiron",
  "NoMad": "nomad",
  "Gramercy": "gramercy",
  "Stuyvesant Town": "stuyvesant-town",
  "West Village": "west-village",
  "Greenwich Village": "greenwich-village",
  "East Village": "east-village",
  "NoHo": "noho",
  "SoHo": "soho",
  "Nolita": "nolita",
  "Little Italy": "little-italy",
  "Chinatown": "chinatown",
  "Lower East Side": "lower-east-side",
  "Two Bridges": "two-bridges",
  "Tribeca": "tribeca",
  "Financial District": "financial-district",
  "Battery Park City": "battery-park-city",
  // Brooklyn
  "Williamsburg": "williamsburg",
  "Greenpoint": "greenpoint",
  "Bushwick": "bushwick",
  "Bed-Stuy": "bed-stuy",
  "Crown Heights": "crown-heights",
  "Park Slope": "park-slope",
  "Carroll Gardens": "carroll-gardens",
  "Cobble Hill": "cobble-hill",
  "Boerum Hill": "boerum-hill",
  "Brooklyn Heights": "brooklyn-heights",
  "DUMBO": "dumbo",
  "Fort Greene": "fort-greene",
  "Clinton Hill": "clinton-hill",
  "Prospect Heights": "prospect-heights",
  // Queens
  "Astoria": "astoria",
  "Long Island City": "long-island-city",
  "Sunnyside": "sunnyside",
  "Jackson Heights": "jackson-heights",
  "Flushing": "flushing",
};

const NEIGHBORHOOD_NAMES = Object.keys(NYC_NEIGHBORHOODS).join(", ");

// ── Search URL builders (inlined from scraper/src/sites/) ────────────────────

function buildStreetEasySearchUrl(params: {
  neighborhoods?: string[];
  minPrice?: number;
  maxPrice?: number;
  beds?: number[];
}): string {
  const { neighborhoods = [], minPrice, maxPrice, beds } = params;
  const toSlug = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // Look up canonical slug first, fall back to toSlug for unknown names
  const toNeighborhoodSlug = (n: string) => NYC_NEIGHBORHOODS[n] ?? toSlug(n);
  const areaSlug =
    neighborhoods.length > 0 && neighborhoods.length <= 5
      ? neighborhoods.map(toNeighborhoodSlug).join(",")
      : "manhattan";
  const qs = new URLSearchParams();
  if (minPrice != null || maxPrice != null) {
    qs.set("price", `${minPrice ?? 0},${maxPrice ?? 50000}`);
  }
  if (beds && beds.length > 0) {
    qs.set("beds", beds.join(","));
  }
  const query = qs.toString();
  return `https://streeteasy.com/for-rent/${areaSlug}${query ? `?${query}` : ""}`;
}

function buildLeaseBreakSearchUrl(params: {
  neighborhoods?: string[];
  minPrice?: number;
  maxPrice?: number;
}): string {
  const qs = new URLSearchParams();
  if (params.minPrice != null) qs.set("min_rent", String(params.minPrice));
  if (params.maxPrice != null) qs.set("max_rent", String(params.maxPrice));
  // /listings/Manhattan returns actual listings; plain /listings only returns borough nav links
  const query = qs.toString();
  return `https://www.leasebreak.com/listings/Manhattan${query ? `?${query}` : ""}`;
}

function buildRentHopSearchUrl(params: {
  neighborhoods?: string[];
  minPrice?: number;
  maxPrice?: number;
  beds?: number[];
}): string {
  const qs = new URLSearchParams();
  if (params.minPrice != null) qs.set("min_price", String(params.minPrice));
  if (params.maxPrice != null) qs.set("max_price", String(params.maxPrice));
  // RentHop supports ?q= for free-text neighborhood/location search
  if (params.neighborhoods && params.neighborhoods.length > 0) {
    qs.set("q", params.neighborhoods[0]);
  }
  // RentHop accepts a single bedrooms= value; use minimum if multiple
  if (params.beds && params.beds.length > 0) {
    qs.set("bedrooms", String(Math.min(...params.beds)));
  }
  const query = qs.toString();
  return `https://www.renthop.com/search/nyc${query ? `?${query}` : ""}`;
}

// ── Claude Haiku: parse prompt into structured search params ──────────────────

type ParsedSearch = {
  prefs: PrefsForScoring;
  wantsFresh: boolean;
  summary: string;
  rawParams: {
    neighborhoods: string[];
    beds: number[];
    minPrice: number;
    maxPrice: number;
    amenities: string[];
    hasExplicitPrice: boolean;
    hasExplicitBeds: boolean;
  };
};

async function parsePrompt(prompt: string): Promise<ParsedSearch> {
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 800,
    messages: [
      {
        role: "user",
        content: `You are an expert NYC apartment search assistant. Parse this search query into structured data.

Query: "${prompt}"

VALID NEIGHBORHOODS — you MUST only return neighborhood names from this exact list:
${NEIGHBORHOOD_NAMES}

TRANSIT KNOWLEDGE — map subway lines to neighborhoods:
- 1/2/3: Upper West Side, Morningside Heights, Hamilton Heights, Washington Heights, Hell's Kitchen, Midtown West, Chelsea, Tribeca, Financial District
- A/C/E: Washington Heights, Harlem, Hell's Kitchen, Chelsea, West Village
- B/D/F/M: Upper West Side, Midtown, Flatiron, SoHo, West Village
- N/Q/R/W: Astoria, Upper East Side, Midtown, Flatiron, SoHo, Chinatown
- 4/5/6: Upper East Side, Midtown East, Murray Hill, Gramercy, Flatiron, Lower East Side
- L: Williamsburg, Bushwick, East Village, Chelsea
- J/M/Z: Bushwick, Bed-Stuy, Lower East Side
- G: Greenpoint, Williamsburg, Park Slope, Carroll Gardens
- If user says "near [line] near [area]" — pick neighborhoods at the INTERSECTION of that line and area.

Return a JSON object:
{
  "minPrice": number (monthly rent min; 0 if not specified),
  "maxPrice": number (monthly rent max; 99999 if not specified),
  "beds": number[] (0=studio, 1=1BR, 2=2BR, 3=3BR, 4=4BR+; [] if not specified),
  "neighborhoods": string[] (2–5 names from the valid list above; [] only if truly anywhere in NYC),
  "amenities": string[] (from: "doorman","elevator","gym","laundry","dishwasher","pets allowed","no fee","outdoor space","parking","roof deck","storage"; use "laundry" for both in-unit and in-building),
  "wantsFresh": boolean (true if user wants new/fresher/more listings or asks to search online),
  "hasExplicitPrice": boolean (true only if user mentioned a price or budget),
  "hasExplicitBeds": boolean (true only if user mentioned bedrooms or studio),
  "summary": string (1 concise sentence, e.g. "Found 1BR apartments in Hell's Kitchen with in-unit laundry")
}

Examples:
- "2BR under $3500 near Central Park" → neighborhoods:["Upper West Side","Morningside Heights"], beds:[2], maxPrice:3500, hasExplicitPrice:true, hasExplicitBeds:true
- "near the 1 line near midtown with laundry" → neighborhoods:["Hell's Kitchen","Midtown West","Chelsea"], amenities:["laundry"]
- "near the L train in Brooklyn" → neighborhoods:["Williamsburg","Bushwick","Greenpoint"]
- "quiet 1BR near a park, pet-friendly" → beds:[1], amenities:["pets allowed"], neighborhoods:["Upper West Side","Morningside Heights","Park Slope"]
- "no fee laundry good for roommates" → amenities:["laundry","no fee"], beds:[2,3]
- "show me newer listings" → wantsFresh:true, neighborhoods:[]

Respond ONLY with valid JSON, no markdown.`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "{}";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const p = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

  const neighborhoods: string[] = Array.isArray(p.neighborhoods) ? p.neighborhoods : [];
  const beds: number[] = Array.isArray(p.beds) ? p.beds : [];
  const amenities: string[] = Array.isArray(p.amenities) ? p.amenities : [];
  const minPrice = typeof p.minPrice === "number" ? p.minPrice : 0;
  const maxPrice = typeof p.maxPrice === "number" ? p.maxPrice : 99999;

  return {
    prefs: { minPrice, maxPrice, beds, neighborhoods, amenities },
    wantsFresh: p.wantsFresh === true,
    summary: typeof p.summary === "string" ? p.summary : "Found apartments matching your search.",
    rawParams: {
      neighborhoods,
      beds,
      minPrice,
      maxPrice,
      amenities,
      hasExplicitPrice: p.hasExplicitPrice === true,
      hasExplicitBeds: p.hasExplicitBeds === true,
    },
  };
}

// ── Claude Haiku: semantic re-rank top 20 candidates ─────────────────────────

async function rerankCandidates(
  prompt: string,
  candidates: { id: string; description: string }[]
): Promise<string[]> {
  const listText = candidates
    .map(
      (c, i) => `${i + 1}. ID:${c.id}\n   ${c.description}`
    )
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content: `NYC apartment search: "${prompt}"

Candidates:
${listText}

Return ONLY a JSON array of the top 10 listing IDs that best match the search query, best match first.
Use the exact ID strings shown after "ID:". Format: ["id1","id2",...]`,
      },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text.trim() : "[]";
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (!arrMatch) return candidates.slice(0, 10).map((c) => c.id);
  try {
    return (JSON.parse(arrMatch[0]) as string[]).slice(0, 10);
  } catch {
    return candidates.slice(0, 10).map((c) => c.id);
  }
}

// ── POST /api/ai-search ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";
    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a few minutes before searching again." },
        { status: 429 }
      );
    }

    const { prompt, scrape = true } = (await req.json()) as { prompt: string; scrape?: boolean };
    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (prompt.length > 500) {
      return NextResponse.json({ error: "Prompt too long" }, { status: 400 });
    }

    // ── Step 1: Parse the prompt ──
    const { prefs, wantsFresh, summary, rawParams } = await parsePrompt(prompt.trim());

    // ── Step 2: Fetch active listings from DB ──
    const rawListings = await prisma.normalizedListing.findMany({
      where: { status: "active" },
      orderBy: { lastSeenAt: "desc" },
      take: 400,
      include: {
        analysis: { select: { summary: true, priceTier: true, redFlags: true } },
      },
    });

    // ── Step 3: Score all listings ──
    const forScoring: ListingForScoring[] = rawListings.map((l) => ({
      id: l.id,
      rentGross: l.rentGross,
      beds: l.beds,
      neighborhood: l.neighborhood,
      borough: l.borough,
      amenities: l.amenities,
      lastSeenAt: l.lastSeenAt,
      photos: l.photos,
      sqft: l.sqft,
      latitude: l.latitude,
      longitude: l.longitude,
      description: l.description,
      address: l.address,
      status: l.status,
    }));

    const withScores = forScoring
      .map((l) => ({ listing: l, score: scoreListing(l, prefs).total }))
      .sort((a, b) => b.score - a.score);

    const top20 = withScores.slice(0, 20);

    // ── Step 5: Semantic re-rank via Claude (only worth it with enough candidates) ──
    let finalIds: string[];
    if (top20.length <= 10) {
      // Too few candidates to bother with re-ranking
      finalIds = top20.map((x) => x.listing.id);
    } else {
      const candidates = top20.map((x) => {
        const l = x.listing;
        const desc = [
          l.beds != null ? `${l.beds}BR` : null,
          l.rentGross ? `$${l.rentGross}/mo` : null,
          l.neighborhood,
          l.sqft ? `${l.sqft}sqft` : null,
          l.description?.slice(0, 100),
        ]
          .filter(Boolean)
          .join(" | ");
        return { id: l.id, description: desc };
      });

      try {
        const ranked = await rerankCandidates(prompt.trim(), candidates);
        // Deduplicate and ensure all returned IDs are valid candidates
        const validIds = new Set(top20.map((x) => x.listing.id));
        finalIds = [...new Set(ranked.filter((id) => validIds.has(id)))];
        // Pad with remaining if < 10
        if (finalIds.length < 10) {
          for (const x of top20) {
            if (finalIds.length >= 10) break;
            if (!finalIds.includes(x.listing.id)) finalIds.push(x.listing.id);
          }
        }
      } catch {
        finalIds = top20.slice(0, 10).map((x) => x.listing.id);
      }
    }

    // ── Step 6: Fetch full listing records ──
    const fullListings = await prisma.normalizedListing.findMany({
      where: { id: { in: finalIds } },
      include: {
        analysis: { select: { summary: true, priceTier: true, redFlags: true } },
      },
    });

    const byId = new Map(fullListings.map((l) => [l.id, l]));
    const orderedListings = finalIds
      .map((id) => byId.get(id))
      .filter(Boolean) as typeof fullListings;

    // Canonical sibling map
    const canonicalIds = [
      ...new Set(
        orderedListings
          .map((l) => l.canonicalUnitId)
          .filter((id): id is string => id != null)
      ),
    ];
    const siblingMap = new Map<string, string[]>();
    if (canonicalIds.length > 0) {
      const siblings = await prisma.normalizedListing.findMany({
        where: { canonicalUnitId: { in: canonicalIds }, status: "active" },
        select: { canonicalUnitId: true, source: true },
      });
      for (const s of siblings) {
        if (!s.canonicalUnitId) continue;
        if (!siblingMap.has(s.canonicalUnitId)) siblingMap.set(s.canonicalUnitId, []);
        siblingMap.get(s.canonicalUnitId)!.push(s.source);
      }
    }

    const scoreMap = new Map(withScores.map((x) => [x.listing.id, x.score]));
    const payload = orderedListings.map((l) => {
      const allSources = l.canonicalUnitId ? (siblingMap.get(l.canonicalUnitId) ?? []) : [];
      const otherSources = [...new Set(allSources.filter((s) => s !== l.source))];
      return {
        ...l,
        price: l.rentGross ?? null,
        matchScore: scoreMap.get(l.id) ?? 0,
        siblingCount: otherSources.length,
        otherSources,
        analysis: l.analysis ?? null,
      };
    });

    // ── Step 7: Trigger scrapes for all sources concurrently (skip on auto-refresh) ──
    if (!scrape) {
      return NextResponse.json({
        listings: payload,
        total: payload.length,
        scrapeTriggered: false,
        runId: null,
        runIds: [],
        summary,
        parsedPrefs: prefs,
      });
    }
    const minPrice = rawParams.hasExplicitPrice && rawParams.minPrice > 0 ? rawParams.minPrice : undefined;
    const maxPrice = rawParams.hasExplicitPrice && rawParams.maxPrice < 99999 ? rawParams.maxPrice : undefined;
    const beds = rawParams.hasExplicitBeds && rawParams.beds.length > 0 ? rawParams.beds : undefined;

    // Leasebreak + RentHop use FlareSolverr (fast, ~30s each); run them first.
    // StreetEasy uses rebrowser (slow, ~2min) and is last so it doesn't block the others.
    const sourceScrapes: { source: string; url: string }[] = [
      { source: "leasebreak", url: buildLeaseBreakSearchUrl({ neighborhoods: rawParams.neighborhoods, minPrice, maxPrice }) },
      { source: "renthop",    url: buildRentHopSearchUrl({ neighborhoods: rawParams.neighborhoods, minPrice, maxPrice, beds }) },
      {
        source: "streeteasy",
        url: buildStreetEasySearchUrl({ neighborhoods: rawParams.neighborhoods, minPrice, maxPrice, beds }),
      },
    ];

    async function triggerSourceScrape(source: string, searchUrl: string): Promise<string> {
      const searchUrlHash = createHash("sha256").update(searchUrl).digest("hex").slice(0, 16);

      const existing = await prisma.crawlJob.findFirst({
        where: { deviceId: null, source, searchUrlHash },
        select: { id: true },
      });

      let crawlJobId: string;
      if (existing) {
        crawlJobId = existing.id;
      } else {
        const job = await prisma.crawlJob.create({
          data: {
            id: randomUUID(),
            deviceId: null,
            source,
            searchUrl,
            searchUrlHash,
            status: "idle",
            nextRunAt: new Date(),
          },
        });
        crawlJobId = job.id;
      }

      const runId = randomUUID();
      await prisma.crawlRun.create({
        data: {
          id: runId,
          source,
          startUrl: searchUrl,
          target: 30,
          discovered: 0,
          scraped: 0,
          errors: 0,
          crawlJobId,
          mode: "targeted",
        },
      });

      await getCrawlQueue().add(
        "crawl-index",
        { source, url: searchUrl, runId, target: 30, crawlJobId },
        { jobId: `ai-search-${runId}` }
      );

      await prisma.crawlJob.update({
        where: { id: crawlJobId },
        data: { status: "running", lastRunAt: new Date() },
      });

      return runId;
    }

    const scrapeResults = await Promise.allSettled(
      sourceScrapes.map(({ source, url }) => triggerSourceScrape(source, url))
    );

    const runIds = scrapeResults
      .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
      .map((r) => r.value);

    scrapeResults.forEach((r, i) => {
      if (r.status === "rejected") {
        console.error(`[ai-search] Failed to trigger scrape for ${sourceScrapes[i].source}:`, r.reason);
      }
    });

    return NextResponse.json({
      listings: payload,
      total: payload.length,
      scrapeTriggered: runIds.length > 0,
      runId: runIds[0] ?? null,
      runIds,
      summary,
      parsedPrefs: prefs,
    });
  } catch (e) {
    console.error("[ai-search] Error:", e);
    return NextResponse.json({ error: "AI search failed" }, { status: 500 });
  }
}

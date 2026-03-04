import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createHash, randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { getCrawlQueue } from "@/lib/queue";
import { scoreListing } from "@/lib/recs/score";
import type { PrefsForScoring, ListingForScoring } from "@/lib/recs/types";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── StreetEasy URL builder (inlined from scraper/src/sites/streeteasy.ts) ─────

function buildStreetEasySearchUrl(params: {
  neighborhoods?: string[];
  minPrice?: number;
  maxPrice?: number;
  beds?: number[];
}): string {
  const { neighborhoods = [], minPrice, maxPrice, beds } = params;
  const toSlug = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const areaSlug =
    neighborhoods.length > 0 && neighborhoods.length <= 5
      ? neighborhoods.map(toSlug).join(",")
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

IMPORTANT TRANSIT KNOWLEDGE — map subway lines to the neighborhoods they serve:
- 1/2/3 line: Upper West Side, Morningside Heights, Hamilton Heights, Washington Heights, Hell's Kitchen, Midtown West, Chelsea, Tribeca, Financial District
- A/C/E line: Washington Heights, Harlem, Hell's Kitchen, Chelsea, West Village
- B/D/F/M line: Upper West Side, Midtown, Flatiron, SoHo, West Village
- N/Q/R/W line: Astoria (Queens), Upper East Side, Midtown, Flatiron, SoHo, Chinatown
- 4/5/6 line: Upper East Side, Midtown East, Murray Hill, Gramercy, Flatiron, Lower East Side
- L line: Williamsburg, Bushwick, East Village, Chelsea
- J/M/Z line: Bushwick, Bed-Stuy, Lower East Side
- G line: Greenpoint, Williamsburg, Park Slope, Carroll Gardens
- If user mentions "near [line] near [area]" — prioritize neighborhoods at the INTERSECTION of that line and area.

Return a JSON object:
{
  "minPrice": number (monthly rent min; 0 if not specified),
  "maxPrice": number (monthly rent max; 99999 if not specified),
  "beds": number[] (0=studio, 1=1BR, 2=2BR, 3=3BR, 4=4BR+; [] if not specified),
  "neighborhoods": string[] (2–5 most relevant NYC neighborhood names based on query; [] only if truly anywhere in NYC),
  "amenities": string[] (from: "doorman","elevator","gym","laundry","dishwasher","pets allowed","no fee","outdoor space","parking","roof deck","storage"; use "laundry" for both in-unit laundry and laundry in building),
  "wantsFresh": boolean (true if user wants new/fresher/more listings or asks to search online/StreetEasy),
  "hasExplicitPrice": boolean (true only if user mentioned a price or budget),
  "hasExplicitBeds": boolean (true only if user mentioned bedrooms or studio),
  "summary": string (1 concise sentence describing what was found, e.g. "Found 1BR apartments in Hell's Kitchen with in-unit laundry")
}

Examples:
- "2BR under $3500 near Central Park" → beds:[2], maxPrice:3500, neighborhoods:["Upper West Side","Manhattan Valley"], hasExplicitPrice:true, hasExplicitBeds:true
- "near the 1 line near midtown with laundry" → neighborhoods:["Hell's Kitchen","Midtown West","Chelsea","Upper West Side"], amenities:["laundry"]
- "near the L train in Brooklyn" → neighborhoods:["Williamsburg","Bushwick","Greenpoint"]
- "quiet 1BR near a park, pet-friendly" → beds:[1], amenities:["pets allowed"]
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
    const { prompt } = (await req.json()) as { prompt: string };
    if (!prompt?.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
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
    const bestScore = top20[0]?.score ?? 0;
    const goodResults = top20.filter((x) => x.score >= 40);

    // ── Step 4: Decide if scrape is needed ──
    const shouldScrape = wantsFresh || goodResults.length < 10 || bestScore < 40;

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
        // Ensure all returned IDs are valid candidates
        const validIds = new Set(top20.map((x) => x.listing.id));
        finalIds = ranked.filter((id) => validIds.has(id));
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

    // ── Step 7: Trigger scrape if needed ──
    let runId: string | null = null;
    if (shouldScrape) {
      try {
        const searchUrl = buildStreetEasySearchUrl({
          neighborhoods: rawParams.neighborhoods,
          minPrice: rawParams.hasExplicitPrice && rawParams.minPrice > 0 ? rawParams.minPrice : undefined,
          maxPrice: rawParams.hasExplicitPrice && rawParams.maxPrice < 99999 ? rawParams.maxPrice : undefined,
          beds: rawParams.hasExplicitBeds && rawParams.beds.length > 0 ? rawParams.beds : undefined,
        });

        const searchUrlHash = createHash("sha256").update(searchUrl).digest("hex").slice(0, 16);

        // Find or create CrawlJob (deviceId=null = registry crawl)
        const existing = await prisma.crawlJob.findFirst({
          where: { deviceId: null, source: "streeteasy", searchUrlHash },
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
              source: "streeteasy",
              searchUrl,
              searchUrlHash,
              status: "idle",
              nextRunAt: new Date(),
            },
          });
          crawlJobId = job.id;
        }

        runId = randomUUID();
        await prisma.crawlRun.create({
          data: {
            id: runId,
            source: "streeteasy",
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
          { source: "streeteasy", url: searchUrl, runId, target: 30, crawlJobId },
          { jobId: `ai-search-${runId}` }
        );

        await prisma.crawlJob.update({
          where: { id: crawlJobId },
          data: { status: "running", lastRunAt: new Date() },
        });
      } catch (e) {
        console.error("[ai-search] Failed to trigger scrape:", e);
        runId = null;
      }
    }

    return NextResponse.json({
      listings: payload,
      total: payload.length,
      scrapeTriggered: shouldScrape && runId != null,
      runId,
      summary,
      parsedPrefs: prefs,
    });
  } catch (e) {
    console.error("[ai-search] Error:", e);
    return NextResponse.json({ error: "AI search failed" }, { status: 500 });
  }
}

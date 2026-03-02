// scraper/src/worker/analyzeText.ts
// Runs Claude Haiku text analysis on every new/updated listing.
//
// Output stored in ListingAnalysis:
//   summary     — 1-2 honest sentences a friend would say
//   priceTier   — "below_market" | "at_market" | "above_market"
//   redFlags    — string[] of decoded broker language
//   brokerSpeak — { phrase, translation }[] pairs
//
// Skips re-analysis when listing content hasn't changed (contentHash gate).

import Anthropic from "@anthropic-ai/sdk";
import { Worker, type Job } from "bullmq";
import { connection, type AnalyzeTextJobData } from "../queues.js";
import { prisma } from "../db.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5-20251001";

// ─────────────────────────────────────────────────────────────────────────────
// Price intelligence — neighborhood median from DB (no external API)
// ─────────────────────────────────────────────────────────────────────────────

interface PriceContext {
  median: number;
  sampleSize: number;
  pctDiff: number; // positive = above market
}

async function getNeighborhoodPriceContext(
  beds: number | null,
  neighborhood: string | null,
  borough: string | null,
  excludeId: string
): Promise<PriceContext | null> {
  const geo = neighborhood ?? borough;
  if (!geo || beds == null) return null;

  const result = await prisma.normalizedListing.aggregate({
    where: {
      id: { not: excludeId },
      beds,
      neighborhood: { contains: geo, mode: "insensitive" },
      status: "active",
      rentGross: { not: null },
      lastSeenAt: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) }, // last 60 days
    },
    _avg: { rentGross: true },
    _count: { rentGross: true },
  });

  const count = result._count.rentGross;
  const avg = result._avg.rentGross;
  if (count < 5 || !avg) return null; // need enough comps to be meaningful

  return { median: Math.round(avg), sampleSize: count, pctDiff: 0 }; // pctDiff computed by caller
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude analysis
// ─────────────────────────────────────────────────────────────────────────────

interface AnalysisResult {
  summary: string;
  priceTier: "below_market" | "at_market" | "above_market";
  redFlags: string[];
  brokerSpeak: { phrase: string; translation: string }[];
}

async function runClaudeAnalysis(listing: {
  rentGross: number | null;
  beds: number | null;
  baths: number | null;
  neighborhood: string | null;
  borough: string | null;
  description: string | null;
  amenities: string;
  address: string | null;
}, priceCtx: PriceContext | null): Promise<AnalysisResult | null> {
  const amenities: string[] = (() => {
    try { return JSON.parse(listing.amenities); } catch { return []; }
  })();

  const location = [listing.neighborhood, listing.borough].filter(Boolean).join(", ");
  const bedroomLabel = listing.beds === 0 ? "Studio" : listing.beds != null ? `${listing.beds}BR` : "";
  const priceLabel = listing.rentGross != null ? `$${listing.rentGross.toLocaleString()}/mo` : "price unknown";

  let priceContext = "";
  if (priceCtx && listing.rentGross) {
    const pct = Math.round(((listing.rentGross - priceCtx.median) / priceCtx.median) * 100);
    const dir = pct > 0 ? "above" : "below";
    priceContext = `\nNeighborhood median for ${bedroomLabel} in ${location}: $${priceCtx.median.toLocaleString()}/mo (this listing is ${Math.abs(pct)}% ${dir} market, n=${priceCtx.sampleSize} comps)`;
  }

  const prompt = `Analyze this NYC apartment listing and return a JSON object. Be direct, honest, and useful — like a friend who knows NYC real estate.

Listing:
- ${bedroomLabel} in ${location || "NYC"} — ${priceLabel}${priceContext}
- Address: ${listing.address ?? "not provided"}
- Amenities: ${amenities.length > 0 ? amenities.slice(0, 15).join(", ") : "none listed"}
- Description: ${listing.description ? listing.description.slice(0, 600) : "none"}

Return ONLY this JSON (no markdown, no explanation):
{
  "summary": "1-2 honest sentences. Be specific. If price is way off, say it. If description sounds good, say it.",
  "priceTier": "below_market" or "at_market" or "above_market",
  "redFlags": ["specific red flag if any — keep empty array if none"],
  "brokerSpeak": [{"phrase": "exact phrase from description", "translation": "what it actually means"}]
}

NYC broker speak to watch for: "cozy/intimate" = tiny, "garden level/garden apartment" = basement or semi-basement, "charming/character" = old and possibly problematic, "easy highway/expressway access" = loud, "railroad layout" = you walk through bedrooms, "flex bedroom" = a room divided by curtain or non-structural wall, "motivated landlord" = something is wrong, "pied-à-terre" = too small to actually live in. Only flag real issues found in this specific listing.`;

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });

    const text = message.content[0].type === "text" ? message.content[0].text.trim() : "";

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as AnalysisResult;

    // Validate shape
    if (typeof parsed.summary !== "string") return null;
    if (!["below_market", "at_market", "above_market"].includes(parsed.priceTier)) {
      parsed.priceTier = "at_market";
    }
    parsed.redFlags = Array.isArray(parsed.redFlags) ? parsed.redFlags.filter(Boolean) : [];
    parsed.brokerSpeak = Array.isArray(parsed.brokerSpeak) ? parsed.brokerSpeak : [];

    return parsed;
  } catch (err) {
    console.warn("[analyze-text] Claude parse error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────────────────────────────────────

async function processAnalyzeText(job: Job<AnalyzeTextJobData>): Promise<void> {
  const { listingId } = job.data;

  const listing = await prisma.normalizedListing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      contentHash: true,
      rentGross: true,
      beds: true,
      baths: true,
      neighborhood: true,
      borough: true,
      description: true,
      amenities: true,
      address: true,
      status: true,
      analysis: { select: { textHash: true } },
    },
  });

  if (!listing || listing.status === "removed") return;

  // Skip if content unchanged since last analysis
  if (listing.analysis?.textHash && listing.analysis.textHash === listing.contentHash) {
    return;
  }

  const priceCtx = await getNeighborhoodPriceContext(
    listing.beds,
    listing.neighborhood,
    listing.borough,
    listingId
  );

  const result = await runClaudeAnalysis(listing, priceCtx);
  if (!result) {
    console.warn(`[analyze-text] No result for ${listingId}`);
    return;
  }

  // Compute priceTier from DB context if model didn't have enough info
  let priceTier = result.priceTier;
  if (priceCtx && listing.rentGross) {
    const pct = ((listing.rentGross - priceCtx.median) / priceCtx.median) * 100;
    if (pct > 10) priceTier = "above_market";
    else if (pct < -10) priceTier = "below_market";
    else priceTier = "at_market";
  }

  await prisma.listingAnalysis.upsert({
    where: { normalizedListingId: listingId },
    create: {
      normalizedListingId: listingId,
      summary: result.summary,
      priceTier,
      redFlags: result.redFlags,
      brokerSpeak: result.brokerSpeak,
      neighborhoodMedian: priceCtx?.median ?? null,
      textHash: listing.contentHash,
      textAnalyzedAt: new Date(),
    },
    update: {
      summary: result.summary,
      priceTier,
      redFlags: result.redFlags,
      brokerSpeak: result.brokerSpeak,
      neighborhoodMedian: priceCtx?.median ?? null,
      textHash: listing.contentHash,
      textAnalyzedAt: new Date(),
    },
  });

  const flagCount = result.redFlags.length;
  console.log(
    `[analyze-text] ${listing.address ?? listingId} → ${priceTier}${flagCount > 0 ? `, ${flagCount} flag(s)` : ""}`
  );
}

export function startAnalyzeTextWorker(): Worker<AnalyzeTextJobData> {
  const worker = new Worker<AnalyzeTextJobData>("analyze-text", processAnalyzeText, {
    connection,
    concurrency: 3, // Claude Haiku handles parallel requests fine
  });

  worker.on("completed", (j) => console.log(`[analyze-text] Job ${j.id} done`));
  worker.on("failed", (j, err) => console.warn(`[analyze-text] Job ${j?.id} failed: ${err.message}`));

  return worker;
}

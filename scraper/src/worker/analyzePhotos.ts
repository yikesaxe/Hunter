// scraper/src/worker/analyzePhotos.ts
// Runs Claude Haiku vision analysis on listing photos to detect deceptive practices:
// wide-angle lens distortion, virtual staging, AI-generated images, and poor quality.
//
// Output stored in ListingAnalysis:
//   photoFlags        — string[] of specific issues found
//   overallPhotoScore — 1–5 quality/honesty score
//   photoHash         — hash of analyzed photo URLs (skip if unchanged)

import Anthropic from "@anthropic-ai/sdk";
import { Worker, type Job } from "bullmq";
import { connection, type AnalyzePhotosJobData } from "../queues.js";
import { prisma } from "../db.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5-20251001";

// ─────────────────────────────────────────────────────────────────────────────
// Claude vision analysis
// ─────────────────────────────────────────────────────────────────────────────

interface PhotoAnalysisResult {
  wideAngleLikely: boolean;
  virtualStagingLikely: boolean;
  aiGeneratedLikely: boolean;
  photoQualityScore: number; // 1–5
  flags: string[];
  photoSummary: string;
}

async function runPhotoAnalysis(photoUrls: string[]): Promise<PhotoAnalysisResult | null> {
  // Build image content blocks (Claude fetches from URL directly)
  const imageBlocks: Anthropic.ImageBlockParam[] = photoUrls.map((url) => ({
    type: "image",
    source: { type: "url", url },
  }));

  const prompt = `You are analyzing apartment listing photos to help renters identify potentially deceptive photography practices.

Examine these ${photoUrls.length} apartment photo(s) and return a JSON analysis.

Score rubric:
5 = Honest, well-lit, wide variety of rooms shown, no distortion
4 = Generally good photos, minor wide-angle or possible light staging
3 = Noticeable issues — significant wide-angle distortion, limited rooms shown, or light staging
2 = Significant issues — obvious virtual staging, AI-generated look, very few interior photos
1 = Highly misleading — extreme distortion, obvious AI/fake images, or almost no real interior photos

Flag examples to emit when relevant:
- "Wide-angle lens — rooms appear larger than they are"
- "Likely virtually staged — furniture looks digitally added"
- "Possible AI-generated images"
- "Dark or low-quality photos"
- "Exterior/street photos only — no interior shots"
- "Very few photos — limited view of the apartment"
- "Missing key rooms (e.g. bedroom or bathroom not shown)"

Return ONLY this JSON (no markdown, no explanation):
{
  "wideAngleLikely": boolean,
  "virtualStagingLikely": boolean,
  "aiGeneratedLikely": boolean,
  "photoQualityScore": 1-5,
  "flags": ["flag string if any issue — empty array if photos look honest"],
  "photoSummary": "1 concise sentence describing what the photos show"
}`;

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [
        {
          role: "user",
          content: [
            ...imageBlocks,
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const text = message.content[0].type === "text" ? message.content[0].text.trim() : "";
    const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as PhotoAnalysisResult;

    // Validate and clamp score
    parsed.photoQualityScore = Math.min(5, Math.max(1, Math.round(parsed.photoQualityScore ?? 3)));
    parsed.flags = Array.isArray(parsed.flags) ? parsed.flags.filter(Boolean) : [];
    parsed.wideAngleLikely = Boolean(parsed.wideAngleLikely);
    parsed.virtualStagingLikely = Boolean(parsed.virtualStagingLikely);
    parsed.aiGeneratedLikely = Boolean(parsed.aiGeneratedLikely);
    parsed.photoSummary = typeof parsed.photoSummary === "string" ? parsed.photoSummary : "";

    return parsed;
  } catch (err) {
    console.warn("[analyze-photos] Claude parse error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker
// ─────────────────────────────────────────────────────────────────────────────

async function processAnalyzePhotos(job: Job<AnalyzePhotosJobData>): Promise<void> {
  const { listingId } = job.data;

  const listing = await prisma.normalizedListing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      photos: true,
      address: true,
      status: true,
      analysis: { select: { photoHash: true } },
    },
  });

  if (!listing || listing.status === "removed") return;

  // Parse photos array
  const allPhotos: string[] = (() => {
    try { return JSON.parse(listing.photos ?? "[]"); } catch { return []; }
  })();

  if (allPhotos.length === 0) return; // no photos, nothing to analyze

  const photos = allPhotos.slice(0, 6); // cap at 6 for cost + latency
  const photoHash = photos.join("|");

  // Hash gate: skip if photos haven't changed since last analysis
  if (listing.analysis?.photoHash === photoHash) return;

  let flags: string[];
  let score: number;

  if (allPhotos.length < 2) {
    // Too few photos — skip Claude, store a low-score flag
    flags = [`Very few photos — only ${allPhotos.length} listed`];
    score = 2;
  } else {
    const result = await runPhotoAnalysis(photos);
    if (!result) {
      console.warn(`[analyze-photos] No result for ${listingId}`);
      return;
    }
    flags = result.flags;
    score = result.photoQualityScore;
  }

  await prisma.listingAnalysis.upsert({
    where: { normalizedListingId: listingId },
    create: {
      normalizedListingId: listingId,
      photoFlags: flags,
      overallPhotoScore: score,
      photoHash,
      photoAnalyzedAt: new Date(),
    },
    update: {
      photoFlags: flags,
      overallPhotoScore: score,
      photoHash,
      photoAnalyzedAt: new Date(),
    },
  });

  const label = listing.address ?? listingId;
  console.log(`[analyze-photos] ${label} → score=${score}${flags.length > 0 ? `, flags: ${flags.join(" | ")}` : " (no issues)"}`);
}

export function startAnalyzePhotosWorker(): Worker<AnalyzePhotosJobData> {
  const worker = new Worker<AnalyzePhotosJobData>("analyze-photos", processAnalyzePhotos, {
    connection,
    concurrency: 2,
  });

  worker.on("completed", (j) => console.log(`[analyze-photos] Job ${j.id} done`));
  worker.on("failed", (j, err) => console.warn(`[analyze-photos] Job ${j?.id} failed: ${err.message}`));

  return worker;
}

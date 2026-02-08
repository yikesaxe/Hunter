import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  parseStreetEasyHtml,
  extractListingId,
} from "@/worker/adapters/streeteasyImport";
import { dedupeAndUpsertCanonical } from "@/worker/pipeline/dedupe";

// TODO: Flowglad subscription guard — check pro features access here

const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB
const PARSE_VERSION = "1.0.0";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Handle CORS preflight for Chrome extension */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/import/streeteasy
 *
 * Accept user-provided StreetEasy page HTML for import.
 * This respects StreetEasy's robots.txt by never crawling — the user
 * copies the page source themselves.
 *
 * Body: { url: string, html: string }
 */
export async function POST(request: NextRequest) {
  let body: { url?: string; html?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const { url, html } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'url' field" },
      { status: 400 }
    );
  }

  if (!html || typeof html !== "string") {
    return NextResponse.json(
      { error: "Missing or invalid 'html' field" },
      { status: 400 }
    );
  }

  if (html.length > MAX_HTML_SIZE) {
    return NextResponse.json(
      { error: `HTML exceeds maximum size of ${MAX_HTML_SIZE / 1024 / 1024}MB` },
      { status: 413 }
    );
  }

  try {
    const now = new Date();
    const sourceListingId = extractListingId(url);

    // 1. Store RawListing
    const rawListing = await prisma.rawListing.upsert({
      where: {
        source_sourceUrl: {
          source: "streeteasy",
          sourceUrl: url,
        },
      },
      update: {
        fetchedAt: now,
        httpStatus: 200,
        rawContent: html,
        parseVersion: PARSE_VERSION,
      },
      create: {
        source: "streeteasy",
        sourceUrl: url,
        sourceListingId: sourceListingId ?? null,
        fetchedAt: now,
        httpStatus: 200,
        rawContent: html,
        parseVersion: PARSE_VERSION,
      },
    });

    // 2. Parse HTML
    const parsed = parseStreetEasyHtml(html, { url, sourceListingId });

    // 3. Store extractedJson
    await prisma.rawListing.update({
      where: { id: rawListing.id },
      data: { extractedJson: JSON.parse(JSON.stringify(parsed)) },
    });

    // 4. Upsert NormalizedListing
    const normalized = await prisma.normalizedListing.upsert({
      where: {
        source_sourceUrl: {
          source: "streeteasy",
          sourceUrl: url,
        },
      },
      update: {
        rawListingId: rawListing.id,
        title: parsed.title,
        description: parsed.description ?? null,
        address: parsed.address ?? null,
        unit: parsed.unit ?? null,
        neighborhood: parsed.neighborhood ?? null,
        borough: parsed.borough ?? null,
        lat: parsed.lat ?? null,
        lng: parsed.lng ?? null,
        rentGross: parsed.rentGross ?? null,
        rentNetEffective: parsed.rentNetEffective ?? null,
        bedrooms: parsed.bedrooms ?? null,
        bathrooms: parsed.bathrooms ?? null,
        brokerFee: parsed.brokerFee ?? null,
        leaseTermMonths: parsed.leaseTermMonths ?? null,
        moveInCostNotes: parsed.moveInCostNotes ?? null,
        petPolicy: parsed.petPolicy ?? null,
        laundry: parsed.laundry ?? null,
        elevator: parsed.elevator ?? null,
        doorman: parsed.doorman ?? null,
        images: parsed.images ?? [],
        lastSeenAt: now,
      },
      create: {
        rawListingId: rawListing.id,
        source: "streeteasy",
        sourceUrl: url,
        title: parsed.title,
        description: parsed.description ?? null,
        address: parsed.address ?? null,
        unit: parsed.unit ?? null,
        neighborhood: parsed.neighborhood ?? null,
        borough: parsed.borough ?? null,
        lat: parsed.lat ?? null,
        lng: parsed.lng ?? null,
        rentGross: parsed.rentGross ?? null,
        rentNetEffective: parsed.rentNetEffective ?? null,
        bedrooms: parsed.bedrooms ?? null,
        bathrooms: parsed.bathrooms ?? null,
        brokerFee: parsed.brokerFee ?? null,
        leaseTermMonths: parsed.leaseTermMonths ?? null,
        moveInCostNotes: parsed.moveInCostNotes ?? null,
        petPolicy: parsed.petPolicy ?? null,
        laundry: parsed.laundry ?? null,
        elevator: parsed.elevator ?? null,
        doorman: parsed.doorman ?? null,
        images: parsed.images ?? [],
        firstSeenAt: now,
        lastSeenAt: now,
      },
    });

    // 5. Run dedupe for this listing
    await dedupeAndUpsertCanonical(normalized.id);

    return NextResponse.json(
      {
        success: true,
        normalizedListingId: normalized.id,
        parsed: {
          title: parsed.title,
          address: parsed.address,
          neighborhood: parsed.neighborhood,
          borough: parsed.borough,
          rentGross: parsed.rentGross,
          bedrooms: parsed.bedrooms,
          bathrooms: parsed.bathrooms,
          brokerFee: parsed.brokerFee,
        },
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    console.error("[import/streeteasy] Error:", err);
    return NextResponse.json(
      {
        error: "Failed to import listing",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// scraper/src/enrichListing.ts
// Uses Claude Haiku to extract structured listing data from the full visible page text.
// Runs after parseListing() to capture amenities, policies, concessions, transit, fees, etc.
// that CSS selectors miss because content is JS-rendered or site-specific.

import Anthropic from "@anthropic-ai/sdk";
import * as cheerio from "cheerio";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = "claude-haiku-4-5-20251001";

// ─────────────────────────────────────────────────────────────────────────────
// Text extraction
// ─────────────────────────────────────────────────────────────────────────────

/** Strip tags, collapse whitespace, remove nav/script noise. Cap at 20000 chars. */
export function extractVisibleText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, footer, header, iframe, svg").remove();
  $("[aria-hidden='true'], [role='navigation'], [role='banner']").remove();
  // Also strip "similar listings" sections which are noise
  $("[class*='similar'], [class*='Similar'], [class*='related'], [class*='Related']").remove();
  $("[class*='neighborhood-desc'], [class*='NeighborhoodDesc']").remove();
  return $("body").text().replace(/\s+/g, " ").trim().slice(0, 20000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Extras type
// ─────────────────────────────────────────────────────────────────────────────

export interface ListingExtras {
  homeFeatures?: string[];
  buildingAmenities?: string[];
  policies?: { pets?: string; smoking?: string; [k: string]: string | undefined };
  fees?: {
    applicationFee?: number;
    securityDeposit?: number;
    brokerFee?: number;
    noFee?: boolean;
    monthlyFees?: { name: string; amount: string; required: boolean }[];
  };
  concessions?: { freeMonths?: number; netEffectiveRent?: number; leaseTerm?: string };
  availability?: string;
  moveInDate?: string;
  daysOnMarket?: number;
  priceHistory?: { date: string; rent: number; event: string }[];
  broker?: { name?: string; company?: string; email?: string; phone?: string };
  transit?: { name: string; lines?: string; distance?: string; walkMinutes?: number }[];
  schools?: { name: string; type?: string; grades?: string; distance?: string }[];
  [key: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude enrichment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send visible page text to Claude Haiku and get back structured listing data.
 * Returns an empty object if the page is too short, Haiku fails, or JSON is invalid.
 */
export async function enrichListingFromText(
  html: string,
): Promise<{ description: string | null; extras: ListingExtras }> {
  const text = extractVisibleText(html);
  if (text.length < 150) return { description: null, extras: {} };

  const prompt = `Extract ALL structured information from this NYC apartment listing page. Return ONLY valid JSON — no markdown, no explanation. Use null for missing fields; omit empty arrays.

Page text:
${text}

JSON schema to fill (extract every field you can find):
{
  "description": "full listing description text (the About/Description section, verbatim and complete)",
  "homeFeatures": ["in-unit features: AC, dishwasher, hardwood floors, W/D, balcony, etc."],
  "buildingAmenities": ["building features: doorman, elevator, gym, pool, roof deck, laundry room, etc."],
  "policies": {
    "pets": "allowed / not allowed / cats only / dogs ok / case by case",
    "smoking": "smoke-free / allowed",
    "guarantors": "accepted / not accepted",
    "noFee": true
  },
  "fees": {
    "applicationFee": 20,
    "securityDeposit": 2500,
    "brokerFee": 0,
    "noFee": true,
    "monthlyFees": [
      {"name": "Liability Insurance", "amount": "$14", "required": false},
      {"name": "Parking", "amount": "$900", "required": false}
    ]
  },
  "concessions": {"freeMonths": 2, "netEffectiveRent": 8400, "leaseTerm": "12-month"},
  "availability": "available now / YYYY-MM-DD",
  "moveInDate": "YYYY-MM-DD",
  "daysOnMarket": 25,
  "priceHistory": [{"date": "2026-02-17", "rent": 10080, "event": "price decreased by 5%"}],
  "broker": {"name": "Agent Name", "company": "Company Name", "email": "agent@co.com", "phone": "555-1234"},
  "transit": [
    {"name": "A/C/B at 96th St", "lines": "A,C,B", "distance": "0.23 mi", "walkMinutes": 5}
  ],
  "schools": [
    {"name": "PS 163 Alfred E Smith", "type": "Public Elementary", "grades": "PK-5", "distance": "0.12 mi"}
  ]
}`;

  try {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].type === "text" ? message.content[0].text.trim() : "";
    const cleaned = raw.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;

    // Pull description out separately; clean nulls from the rest
    const description = typeof parsed.description === "string" && parsed.description.length > 20
      ? parsed.description
      : null;
    delete parsed.description;

    const extras: ListingExtras = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      (extras as Record<string, unknown>)[k] = v;
    }

    return { description, extras };
  } catch {
    return { description: null, extras: {} };
  }
}

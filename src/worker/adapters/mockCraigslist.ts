import * as fs from "fs";
import * as path from "path";
import {
  SourceAdapter,
  DiscoveredListing,
  FetchResult,
} from "./SourceAdapter";
import { NormalizedListingInput } from "@/lib/domain/types";

const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures/mock_craigslist");

/**
 * Normalize Craigslist borough names to title case.
 */
function normalizeBoro(boro: string): string {
  const map: Record<string, string> = {
    manhattan: "Manhattan",
    brooklyn: "Brooklyn",
    queens: "Queens",
    bronx: "Bronx",
    "staten island": "Staten Island",
  };
  return map[boro.toLowerCase()] ?? boro;
}

/**
 * Parse Craigslist-style address to extract unit if embedded.
 * e.g. "245 E 7th St Apt 3A" -> { address: "245 E 7th St", unit: "3A" }
 */
function parseAddress(location: string): { address: string; unit: string | null } {
  const unitMatch = location.match(
    /[,\s]+(?:apt|apartment|unit|suite|ste|#)\s*\.?\s*(\w+)\s*$/i
  );
  if (unitMatch) {
    return {
      address: location.slice(0, unitMatch.index).trim(),
      unit: unitMatch[1],
    };
  }
  return { address: location.trim(), unit: null };
}

/**
 * Normalize Craigslist fee field to boolean.
 */
function parseFee(fee: string | undefined): boolean | null {
  if (!fee) return null;
  const lower = fee.toLowerCase();
  if (lower.includes("no fee")) return false;
  if (lower.includes("broker") || lower.includes("fee")) return true;
  return null;
}

/**
 * Normalize Craigslist pet field.
 */
function parsePets(pets: string | undefined): string | null {
  if (!pets) return null;
  const lower = pets.toLowerCase();
  if (lower.includes("no pet")) return "no_pets";
  if (lower.includes("dogs") && lower.includes("cats")) return "pets_allowed";
  if (lower.includes("cats")) return "cats_only";
  if (lower.includes("dogs")) return "dogs_only";
  return pets;
}

/**
 * Normalize Craigslist laundry field.
 */
function parseLaundry(laundry: string | undefined): string | null {
  if (!laundry) return null;
  const lower = laundry.toLowerCase();
  if (lower.includes("in unit") || lower.includes("w/d in unit"))
    return "in_unit";
  if (lower.includes("in bldg") || lower.includes("in building"))
    return "in_building";
  return laundry;
}

export const mockCraigslistAdapter: SourceAdapter = {
  name: "mock_craigslist",

  async discover(): Promise<DiscoveredListing[]> {
    const files = fs
      .readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith(".json"));
    return files.map((f) => ({
      url: `file://${FIXTURES_DIR}/${f}`,
      sourceListingId: path.basename(f, ".json"),
    }));
  },

  async fetch(url: string): Promise<FetchResult> {
    const filePath = url.replace("file://", "");
    const content = fs.readFileSync(filePath, "utf-8");
    return { httpStatus: 200, content };
  },

  async parse(
    content: string,
    meta: { url: string; sourceListingId?: string }
  ): Promise<NormalizedListingInput & { title: string }> {
    const data = JSON.parse(content);
    const { address, unit } = parseAddress(data.location ?? "");

    return {
      source: "mock_craigslist",
      sourceUrl: meta.url,
      title: data.post_title,
      description: data.body ?? null,
      address: address || null,
      unit: unit,
      neighborhood: data.area ?? null,
      borough: data.boro ? normalizeBoro(data.boro) : null,
      lat: data.latitude ?? null,
      lng: data.longitude ?? null,
      rentGross: data.price ?? null,
      rentNetEffective: null, // Craigslist doesn't list net effective
      bedrooms: data.br ?? null,
      bathrooms: data.ba ?? null,
      brokerFee: parseFee(data.fee),
      leaseTermMonths: null, // Craigslist rarely specifies
      petPolicy: parsePets(data.pets),
      laundry: parseLaundry(data.laundry_situation),
      elevator: data.has_elevator ?? null,
      doorman: data.has_doorman ?? null,
      images: data.pic_urls ?? [],
    };
  },
};

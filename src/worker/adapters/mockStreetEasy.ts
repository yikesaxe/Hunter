import * as fs from "fs";
import * as path from "path";
import {
  SourceAdapter,
  DiscoveredListing,
  FetchResult,
} from "./SourceAdapter";
import { NormalizedListingInput } from "@/lib/domain/types";

const FIXTURES_DIR = path.resolve(process.cwd(), "fixtures/mock_streeteasy");

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const mockStreetEasyAdapter: SourceAdapter = {
  name: "mock_streeteasy",

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
    return {
      source: "mock_streeteasy",
      sourceUrl: meta.url,
      title: data.title,
      description: data.description ?? null,
      address: data.address ?? null,
      unit: data.unit ?? null,
      neighborhood: data.neighborhood ?? null,
      borough: data.borough ? capitalize(data.borough) : null,
      lat: data.lat ?? null,
      lng: data.lng ?? null,
      rentGross: data.rent ?? null,
      rentNetEffective: data.netEffectiveRent ?? null,
      bedrooms: data.bedrooms ?? null,
      bathrooms: data.bathrooms ?? null,
      brokerFee: data.brokerFee ?? null,
      leaseTermMonths: data.leaseTermMonths ?? null,
      petPolicy: data.petPolicy ?? null,
      laundry: data.laundry ?? null,
      elevator: data.elevator ?? null,
      doorman: data.doorman ?? null,
      images: data.images ?? [],
    };
  },
};

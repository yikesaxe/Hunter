import { NormalizedListingInput } from "@/lib/domain/types";

/**
 * Interface that every listing source must implement.
 * Each adapter knows how to discover, fetch, and parse listings from one source.
 */
export interface SourceAdapter {
  /** Unique name for this source (e.g. "mock_streeteasy", "mock_craigslist") */
  name: string;

  /** Return a list of listing URLs to fetch */
  discover(): Promise<DiscoveredListing[]>;

  /** Fetch raw content from a listing URL */
  fetch(url: string): Promise<FetchResult>;

  /** Parse raw content into a normalized listing payload */
  parse(
    content: string,
    meta: { url: string; sourceListingId?: string }
  ): Promise<NormalizedListingInput & { title: string }>;
}

export interface DiscoveredListing {
  url: string;
  sourceListingId?: string;
}

export interface FetchResult {
  httpStatus: number;
  content: string;
  finalUrl?: string;
}

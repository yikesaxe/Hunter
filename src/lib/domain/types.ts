/**
 * Domain types mirroring Prisma models for use in adapters and pipeline code.
 * These decouple business logic from Prisma's generated types.
 */

export interface RawListingInput {
  source: string;
  sourceUrl: string;
  sourceListingId?: string | null;
  fetchedAt: Date;
  httpStatus?: number | null;
  rawContent?: string | null;
  extractedJson?: unknown | null;
  parseVersion: string;
}

export interface NormalizedListingInput {
  source: string;
  sourceUrl: string;
  title: string;
  description?: string | null;
  address?: string | null;
  unit?: string | null;
  neighborhood?: string | null;
  borough?: string | null;
  lat?: number | null;
  lng?: number | null;
  rentGross?: number | null;
  rentNetEffective?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  brokerFee?: boolean | null;
  leaseTermMonths?: number | null;
  moveInCostNotes?: string | null;
  petPolicy?: string | null;
  laundry?: string | null;
  elevator?: boolean | null;
  doorman?: boolean | null;
  images?: string[];
}

export interface CanonicalUnitFields {
  canonicalAddress?: string | null;
  canonicalUnit?: string | null;
  neighborhood?: string | null;
  borough?: string | null;
  lat?: number | null;
  lng?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  bestRentGross?: number | null;
  bestRentNetEffective?: number | null;
  brokerFee?: boolean | null;
  activeState: "active" | "stale" | "unknown";
  lastSeenAt: Date;
}

export type ActiveState = "active" | "stale" | "unknown";

export type ChangeKind = "price_change" | "status_change" | "field_change";

export interface ChangeLogEntry {
  canonicalUnitId: string;
  normalizedListingId?: string | null;
  kind: ChangeKind;
  payload: Record<string, unknown>;
}

/**
 * Map listing/source amenity strings to canonical tokens matching onboarding options.
 * Onboarding amenities: Doorman, Elevator, In-unit laundry, Dishwasher, Pet-friendly,
 * Gym, Rooftop, Outdoor space, Parking, Storage, No broker fee, Concierge.
 */

const SYNONYMS: Record<string, string> = {
  doorman: "Doorman",
  "24 hour doorman": "Doorman",
  "full time doorman": "Doorman",
  concierge: "Concierge",
  elevator: "Elevator",
  elevators: "Elevator",
  "in-unit laundry": "In-unit laundry",
  "washer/dryer": "In-unit laundry",
  "washer dryer": "In-unit laundry",
  "washer & dryer": "In-unit laundry",
  "laundry in unit": "In-unit laundry",
  "in unit washer": "In-unit laundry",
  dishwasher: "Dishwasher",
  "pet friendly": "Pet-friendly",
  "pets allowed": "Pet-friendly",
  "cats allowed": "Pet-friendly",
  "dogs allowed": "Pet-friendly",
  gym: "Gym",
  "fitness center": "Gym",
  "fitness room": "Gym",
  rooftop: "Rooftop",
  "rooftop deck": "Rooftop",
  "outdoor space": "Outdoor space",
  terrace: "Outdoor space",
  balcony: "Outdoor space",
  patio: "Outdoor space",
  garden: "Outdoor space",
  parking: "Parking",
  "garage": "Parking",
  "storage": "Storage",
  "storage unit": "Storage",
  "no broker fee": "No broker fee",
  "no fee": "No broker fee",
  "no broker's fee": "No broker fee",
};

const CANONICAL_SET = new Set([
  "Doorman", "Elevator", "In-unit laundry", "Dishwasher", "Pet-friendly",
  "Gym", "Rooftop", "Outdoor space", "Parking", "Storage", "No broker fee", "Concierge",
]);

/**
 * Parse Listing.amenities (JSON string array) safely. Returns string[].
 */
export function parseListingAmenities(amenities: string | null | undefined): string[] {
  if (amenities == null || amenities === "") return [];
  if (typeof amenities !== "string") return [];
  try {
    const parsed = JSON.parse(amenities);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

/**
 * Normalize a single amenity string to canonical token or null.
 */
export function normalizeAmenity(raw: string): string | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  return SYNONYMS[key] ?? (CANONICAL_SET.has(raw.trim()) ? raw.trim() : null);
}

/**
 * Return set of canonical amenity tokens present in the listing (parsed from JSON string).
 */
export function canonicalAmenitiesFromListing(amenitiesJson: string | null | undefined): Set<string> {
  const raw = parseListingAmenities(amenitiesJson);
  const out = new Set<string>();
  for (const a of raw) {
    const c = normalizeAmenity(a);
    if (c) out.add(c);
  }
  return out;
}

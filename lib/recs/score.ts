import { canonicalAmenitiesFromListing } from "@/lib/normalize/amenities";
import type { PrefsForScoring, ListingForScoring, WeightsProfile, ScoreBreakdown } from "./types";

const BUDGET_WEIGHT = 25;
const BEDS_WEIGHT = 15;
const NEIGHBORHOOD_WEIGHT = 25;
const AMENITIES_WEIGHT = 15;
const RECENCY_WEIGHT = 10;
const COMPLETENESS_WEIGHT = 10;
const WEIGHT_CAP = 2;
const WEIGHT_FLOOR = -2;

/**
 * Hard filters: must pass for listing to be included in recommended feed.
 * Returns false if listing should be excluded.
 */
export function passesHardFilters(
  listing: ListingForScoring,
  prefs: PrefsForScoring,
  options: { includeUnknownPrice?: boolean } = {}
): boolean {
  if (listing.status !== "active") return false;
  if (prefs.neighborhoods.length > 0) {
    const n = (listing.neighborhood ?? "").trim();
    if (!n) return false;
    const match = prefs.neighborhoods.some(
      (pn) => pn.toLowerCase() === n.toLowerCase() || n.toLowerCase().includes(pn.toLowerCase())
    );
    if (!match) return false;
  }
  if (prefs.beds.length > 0) {
    const listingBeds = listing.beds;
    if (listingBeds == null && !options.includeUnknownPrice) return false;
    if (listingBeds != null) {
      const bedMatch = prefs.beds.some((b) => b === listingBeds || (b === 4 && listingBeds >= 4));
      if (!bedMatch) return false;
    }
  }
  if (listing.rentGross != null) {
    if (listing.rentGross < prefs.minPrice || listing.rentGross > prefs.maxPrice) return false;
  } else if (!options.includeUnknownPrice) {
    return false;
  }
  return true;
}

/**
 * Compute soft score 0..100 and breakdown. Uses learned weights if provided.
 */
export function scoreListing(
  listing: ListingForScoring,
  prefs: PrefsForScoring,
  weights?: WeightsProfile | null
): ScoreBreakdown {
  const w = weights ?? {};
  const neighborhoodWeights = w.neighborhood ?? {};
  const boroughWeights = w.borough ?? {};
  const amenityWeights = w.amenity ?? {};

  let budgetFit = 0;
  if (listing.rentGross != null && prefs.minPrice <= listing.rentGross && listing.rentGross <= prefs.maxPrice) {
    const mid = (prefs.minPrice + prefs.maxPrice) / 2;
    const range = prefs.maxPrice - prefs.minPrice || 1;
    const dist = Math.abs(listing.rentGross - mid) / range;
    budgetFit = Math.max(0, 1 - dist * 2) * BUDGET_WEIGHT; // triangle: best at middle
  }

  let bedsFit = 0;
  if (prefs.beds.length > 0 && listing.beds != null) {
    const match = prefs.beds.some((b) => b === listing.beds || (b === 4 && (listing.beds ?? 0) >= 4));
    bedsFit = match ? BEDS_WEIGHT : BEDS_WEIGHT * 0.2; // small bonus if above min
  } else if (prefs.beds.length === 0) {
    bedsFit = BEDS_WEIGHT;
  }

  let neighborhoodBoost = 0;
  const n = (listing.neighborhood ?? "").trim();
  const b = (listing.borough ?? "").trim();
  if (prefs.neighborhoods.length > 0) {
    const prefNeighborhoodMatch = prefs.neighborhoods.some(
      (pn) => pn.toLowerCase() === n.toLowerCase() || n.toLowerCase().includes(pn.toLowerCase())
    );
    const prefBoroughMatch = b && prefs.neighborhoods.some((pn) => pn.toLowerCase() === b.toLowerCase());
    if (prefNeighborhoodMatch) {
      const wN = neighborhoodWeights[n] ?? 1;
      neighborhoodBoost = Math.min(WEIGHT_CAP, Math.max(WEIGHT_FLOOR, 1 + (wN ?? 0))) * (NEIGHBORHOOD_WEIGHT / 2);
      neighborhoodBoost += NEIGHBORHOOD_WEIGHT / 2;
    } else if (prefBoroughMatch) {
      const wB = boroughWeights[b] ?? 1;
      neighborhoodBoost = Math.min(WEIGHT_CAP, Math.max(WEIGHT_FLOOR, 1 + (wB ?? 0))) * (NEIGHBORHOOD_WEIGHT * 0.3);
    }
  } else {
    neighborhoodBoost = NEIGHBORHOOD_WEIGHT;
  }

  const listingAmenities = canonicalAmenitiesFromListing(listing.amenities);
  let amenitiesMatch = 0;
  if (prefs.amenities.length > 0) {
    const matched = prefs.amenities.filter((a) => listingAmenities.has(a));
    const mult = matched.length / prefs.amenities.length;
    let weightMult = 1;
    for (const a of matched) {
      weightMult *= Math.min(WEIGHT_CAP, Math.max(WEIGHT_FLOOR, 1 + (amenityWeights[a] ?? 0)));
    }
    amenitiesMatch = Math.min(1, weightMult) * mult * AMENITIES_WEIGHT;
  } else {
    amenitiesMatch = AMENITIES_WEIGHT;
  }

  let recency = 0;
  const now = Date.now();
  const seen = listing.lastSeenAt.getTime();
  const daysSince = (now - seen) / (24 * 60 * 60 * 1000);
  if (daysSince <= 1) recency = RECENCY_WEIGHT;
  else if (daysSince <= 7) recency = RECENCY_WEIGHT * 0.8;
  else if (daysSince <= 30) recency = RECENCY_WEIGHT * 0.5;
  else recency = RECENCY_WEIGHT * 0.2;

  let completeness = 0;
  try {
    const photoCount = Array.isArray(JSON.parse(listing.photos ?? "[]")) ? (JSON.parse(listing.photos) as unknown[]).length : 0;
    if (photoCount > 0) completeness += 3;
    if (listing.sqft != null) completeness += 2;
    if (listing.latitude != null && listing.longitude != null) completeness += 2;
    if (listing.description && listing.description.length > 20) completeness += 3;
    completeness = (completeness / 10) * COMPLETENESS_WEIGHT;
  } catch {
    completeness = 0;
  }

  const total = Math.min(100, Math.round(budgetFit + bedsFit + neighborhoodBoost + amenitiesMatch + recency + completeness));
  const weightMultiplier = 1; // already applied inside neighborhoodBoost and amenitiesMatch

  return {
    budgetFit,
    bedsFit,
    neighborhoodBoost,
    amenitiesMatch,
    recency,
    completeness,
    total,
    weightMultiplier,
  };
}

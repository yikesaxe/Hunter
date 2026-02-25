import { canonicalAmenitiesFromListing } from "@/lib/normalize/amenities";
import type { PrefsForScoring, ListingForScoring, ScoreBreakdown } from "./types";

export function getMatchReasons(
  listing: ListingForScoring,
  prefs: PrefsForScoring,
  breakdown: ScoreBreakdown
): string[] {
  const reasons: { text: string; sortKey: number }[] = [];

  if (breakdown.budgetFit > 0 && listing.price != null) {
    reasons.push({ text: "Matches your budget", sortKey: breakdown.budgetFit });
  }
  if (breakdown.bedsFit > 0 && listing.beds != null) {
    const bedLabel = listing.beds === 0 ? "Studio" : `${listing.beds} BR`;
    reasons.push({ text: `Right size (${bedLabel})`, sortKey: breakdown.bedsFit });
  }
  if (breakdown.neighborhoodBoost > 0 && listing.neighborhood) {
    reasons.push({ text: `In ${listing.neighborhood}`, sortKey: breakdown.neighborhoodBoost });
  }
  if (breakdown.amenitiesMatch > 0 && prefs.amenities.length > 0) {
    const listingCanonical = canonicalAmenitiesFromListing(listing.amenities);
    const matched = prefs.amenities.filter((a) => listingCanonical.has(a));
    if (matched.length > 0) {
      reasons.push({
        text: matched.length === 1 ? `Has ${matched[0]}` : `Has ${matched.slice(0, 3).join(" + ")}`,
        sortKey: breakdown.amenitiesMatch,
      });
    }
  }
  if (breakdown.recency > 5) {
    reasons.push({ text: "Recently updated", sortKey: breakdown.recency });
  }
  if (breakdown.completeness > 5) {
    reasons.push({ text: "Complete listing details", sortKey: breakdown.completeness });
  }

  reasons.sort((a, b) => b.sortKey - a.sortKey);
  return reasons.slice(0, 3).map((r) => r.text);
}

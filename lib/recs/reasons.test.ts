import { describe, it, expect } from "vitest";
import { getMatchReasons } from "./reasons";
import type { ListingForScoring, PrefsForScoring, ScoreBreakdown } from "./types";

const listing: ListingForScoring = {
  id: "1",
  rentGross: 3000,
  beds: 2,
  neighborhood: "Chelsea",
  borough: "Manhattan",
  amenities: '["Doorman","Elevator"]',
  lastSeenAt: new Date(),
  photos: '["https://example.com/1.jpg"]',
  sqft: 1000,
  latitude: 40.7,
  longitude: -74,
  description: "Nice place",
  address: "123 Main St",
  status: "active",
};

const prefs: PrefsForScoring = {
  minPrice: 2000,
  maxPrice: 5000,
  beds: [1, 2],
  neighborhoods: ["Chelsea"],
  amenities: ["Doorman", "Elevator"],
};

const breakdown: ScoreBreakdown = {
  budgetFit: 20,
  bedsFit: 15,
  neighborhoodBoost: 20,
  amenitiesMatch: 15,
  recency: 8,
  completeness: 8,
  total: 86,
  weightMultiplier: 1,
};

describe("getMatchReasons", () => {
  it("returns up to 3 reasons", () => {
    const reasons = getMatchReasons(listing, prefs, breakdown);
    expect(reasons.length).toBeLessThanOrEqual(3);
  });

  it("includes neighborhood when boost > 0", () => {
    const reasons = getMatchReasons(listing, prefs, breakdown);
    expect(reasons.some((r) => r.includes("Chelsea"))).toBe(true);
  });

  it("includes budget when budgetFit > 0", () => {
    const reasons = getMatchReasons(listing, prefs, breakdown);
    expect(reasons.some((r) => r.toLowerCase().includes("budget"))).toBe(true);
  });

  it("is stable for same inputs", () => {
    const a = getMatchReasons(listing, prefs, breakdown);
    const b = getMatchReasons(listing, prefs, breakdown);
    expect(a).toEqual(b);
  });
});

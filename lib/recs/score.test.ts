import { describe, it, expect } from "vitest";
import { passesHardFilters, scoreListing } from "./score";
import type { ListingForScoring, PrefsForScoring } from "./types";

const baseListing: ListingForScoring = {
  id: "1",
  price: 3000,
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
  neighborhoods: ["Chelsea", "West Village"],
  amenities: ["Doorman", "Elevator"],
};

describe("passesHardFilters", () => {
  it("passes when listing matches prefs", () => {
    expect(passesHardFilters(baseListing, prefs)).toBe(true);
  });

  it("fails when status is not active", () => {
    expect(passesHardFilters({ ...baseListing, status: "inactive" }, prefs)).toBe(false);
  });

  it("fails when neighborhood not in prefs", () => {
    expect(
      passesHardFilters({ ...baseListing, neighborhood: "Harlem" }, prefs)
    ).toBe(false);
  });

  it("fails when price below min", () => {
    expect(passesHardFilters({ ...baseListing, price: 1000 }, prefs)).toBe(false);
  });

  it("fails when price above max", () => {
    expect(passesHardFilters({ ...baseListing, price: 6000 }, prefs)).toBe(false);
  });

  it("fails when beds not in prefs", () => {
    expect(passesHardFilters({ ...baseListing, beds: 4 }, prefs)).toBe(false);
  });
});

describe("scoreListing", () => {
  it("scores better match higher than worse match", () => {
    const good = scoreListing(baseListing, prefs);
    const noAmenities = scoreListing(
      { ...baseListing, amenities: "[]" },
      prefs
    );
    const wrongHood = scoreListing(
      { ...baseListing, neighborhood: "Harlem" },
      { ...prefs, neighborhoods: ["Chelsea"] }
    );
    expect(good.total).toBeGreaterThanOrEqual(noAmenities.total);
    expect(good.total).toBeGreaterThanOrEqual(wrongHood.total);
  });

  it("returns breakdown with all components", () => {
    const b = scoreListing(baseListing, prefs);
    expect(b).toHaveProperty("budgetFit");
    expect(b).toHaveProperty("bedsFit");
    expect(b).toHaveProperty("neighborhoodBoost");
    expect(b).toHaveProperty("amenitiesMatch");
    expect(b).toHaveProperty("recency");
    expect(b).toHaveProperty("completeness");
    expect(b).toHaveProperty("total");
    expect(typeof b.total).toBe("number");
    expect(b.total).toBeLessThanOrEqual(100);
  });
});

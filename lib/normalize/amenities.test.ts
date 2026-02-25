import { describe, it, expect } from "vitest";
import {
  parseListingAmenities,
  normalizeAmenity,
  canonicalAmenitiesFromListing,
} from "./amenities";

describe("parseListingAmenities", () => {
  it("returns empty array for null or empty", () => {
    expect(parseListingAmenities(null)).toEqual([]);
    expect(parseListingAmenities(undefined)).toEqual([]);
    expect(parseListingAmenities("")).toEqual([]);
  });

  it("parses valid JSON array of strings", () => {
    expect(parseListingAmenities('["Doorman","Elevator"]')).toEqual(["Doorman", "Elevator"]);
    expect(parseListingAmenities("[]")).toEqual([]);
  });

  it("filters non-strings", () => {
    expect(parseListingAmenities('["a",1,null,"b"]')).toEqual(["a", "b"]);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseListingAmenities("not json")).toEqual([]);
    expect(parseListingAmenities("{ }")).toEqual([]);
  });

  it("handles non-array JSON safely", () => {
    expect(parseListingAmenities('{"a":1}')).toEqual([]);
  });

  it("handles truncated or malformed JSON safely (dedupe-safe)", () => {
    expect(parseListingAmenities('["Doorman"')).toEqual([]);
    expect(parseListingAmenities('["Doorman",')).toEqual([]);
    expect(parseListingAmenities('')).toEqual([]);
    expect(parseListingAmenities('null')).toEqual([]);
  });
});

describe("normalizeAmenity", () => {
  it("maps synonyms to canonical", () => {
    expect(normalizeAmenity("doorman")).toBe("Doorman");
    expect(normalizeAmenity("washer/dryer")).toBe("In-unit laundry");
    expect(normalizeAmenity("pet friendly")).toBe("Pet-friendly");
    expect(normalizeAmenity("fitness center")).toBe("Gym");
    expect(normalizeAmenity("no fee")).toBe("No broker fee");
  });

  it("returns canonical when already canonical", () => {
    expect(normalizeAmenity("Doorman")).toBe("Doorman");
    expect(normalizeAmenity("Elevator")).toBe("Elevator");
  });

  it("returns null for unknown", () => {
    expect(normalizeAmenity("unknown thing")).toBe(null);
  });
});

describe("canonicalAmenitiesFromListing", () => {
  it("returns set of canonical tokens from JSON string", () => {
    const set = canonicalAmenitiesFromListing('["Doorman", "washer/dryer", "Gym"]');
    expect(set.has("Doorman")).toBe(true);
    expect(set.has("In-unit laundry")).toBe(true);
    expect(set.has("Gym")).toBe(true);
    expect(set.size).toBe(3);
  });

  it("handles invalid JSON safely", () => {
    expect(canonicalAmenitiesFromListing("invalid").size).toBe(0);
    expect(canonicalAmenitiesFromListing(null).size).toBe(0);
  });

  it("dedupes and normalizes", () => {
    const set = canonicalAmenitiesFromListing('["doorman", "Doorman", "elevator"]');
    expect(set.has("Doorman")).toBe(true);
    expect(set.has("Elevator")).toBe(true);
    expect(set.size).toBe(2);
  });
});

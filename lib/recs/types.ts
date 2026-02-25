export type PrefsForScoring = {
  minPrice: number;
  maxPrice: number;
  beds: number[];
  neighborhoods: string[];
  amenities: string[];
};

export type ListingForScoring = {
  id: string;
  rentGross: number | null;
  beds: number | null;
  neighborhood: string | null;
  borough: string | null;
  amenities: string; // JSON string array
  lastSeenAt: Date;
  photos: string; // JSON string array
  sqft: number | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  address: string | null;
  status: string;
};

export type WeightsProfile = {
  neighborhood?: Record<string, number>;
  borough?: Record<string, number>;
  amenity?: Record<string, number>;
};

export type ScoreBreakdown = {
  budgetFit: number;
  bedsFit: number;
  neighborhoodBoost: number;
  amenitiesMatch: number;
  recency: number;
  completeness: number;
  total: number;
  weightMultiplier: number; // from learned weights
};

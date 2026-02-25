import { prisma } from "@/lib/db";
import { canonicalAmenitiesFromListing } from "@/lib/normalize/amenities";
import type { WeightsProfile } from "./types";

const DELTA_SAVE = 0.3;
const DELTA_HIDE = -0.4;
const DELTA_CLICK = 0.1;
const MIN_WEIGHT = -2;
const MAX_WEIGHT = 2;

function clamp(v: number): number {
  return Math.min(MAX_WEIGHT, Math.max(MIN_WEIGHT, v));
}

/**
 * Update DeviceProfile weights from a single event. Call after recording the event.
 */
export async function learnFromEvent(
  deviceId: string,
  listingId: string,
  type: "save" | "hide" | "click"
): Promise<void> {
  const listing = await prisma.normalizedListing.findUnique({
    where: { id: listingId },
    select: { neighborhood: true, borough: true, amenities: true },
  });
  if (!listing) return;

  const delta = type === "save" ? DELTA_SAVE : type === "hide" ? DELTA_HIDE : DELTA_CLICK;
  const profile = await prisma.deviceProfile.findUnique({ where: { deviceId } });
  const weights: WeightsProfile = profile?.weights
    ? (profile.weights as WeightsProfile)
    : { neighborhood: {}, borough: {}, amenity: {} };

  if (listing.neighborhood) {
    const key = listing.neighborhood.trim();
    if (key) {
      weights.neighborhood = weights.neighborhood ?? {};
      weights.neighborhood[key] = clamp((weights.neighborhood[key] ?? 0) + delta);
    }
  }
  if (listing.borough) {
    const key = listing.borough.trim();
    if (key) {
      weights.borough = weights.borough ?? {};
      weights.borough[key] = clamp((weights.borough[key] ?? 0) + delta);
    }
  }
  const canonical = canonicalAmenitiesFromListing(listing.amenities);
  for (const a of canonical) {
    weights.amenity = weights.amenity ?? {};
    weights.amenity[a] = clamp((weights.amenity[a] ?? 0) + delta);
  }

  await prisma.deviceProfile.upsert({
    where: { deviceId },
    create: { deviceId, weights, stats: {} },
    update: { weights, updatedAt: new Date() },
  });
}

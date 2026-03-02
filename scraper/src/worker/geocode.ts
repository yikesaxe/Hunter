// scraper/src/worker/geocode.ts
// Geocode NormalizedListing addresses using Nominatim (OpenStreetMap).
// Rate-limited to 1 req/sec via BullMQ limiter to comply with Nominatim ToS.
//
// After successfully geocoding, enqueues analyze-neighborhood so the
// neighborhood data worker (Phase 3) can run once coordinates are known.

import { Worker, type Job } from "bullmq";
import { connection, type GeocodeJobData } from "../queues.js";
import { prisma } from "../db.js";

// Photon geocoder (OSM-based, no key required, bulk-friendly)
const PHOTON_URL = "https://photon.komoot.io/api/";

interface PhotonFeature {
  geometry: { coordinates: [number, number] }; // [lon, lat]
  properties: { countrycode?: string; city?: string; state?: string };
}

/**
 * Geocode an address string via Photon (photon.komoot.io).
 * Biased toward NYC with a bounding box filter.
 */
async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  const query = `${address}, New York City, NY`;
  const url = new URL(PHOTON_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "1");
  url.searchParams.set("lang", "en");
  // Bias search toward NYC bounding box
  url.searchParams.set("bbox", "-74.3,40.4,-73.65,40.95");

  const res = await fetch(url.toString(), {
    headers: { "User-Agent": "Hunter/1.0" },
  });

  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);

  const data: { features: PhotonFeature[] } = await res.json();
  if (!data.features?.length) return null;

  const [lon, lat] = data.features[0].geometry.coordinates;

  // Sanity check: must be within NYC bounding box
  if (lat < 40.4 || lat > 40.95 || lon < -74.3 || lon > -73.65) return null;

  return { lat, lon };
}

async function processGeocode(job: Job<GeocodeJobData>): Promise<void> {
  const { listingId } = job.data;

  const listing = await prisma.normalizedListing.findUnique({
    where: { id: listingId },
    select: { id: true, address: true, borough: true, latitude: true, longitude: true },
  });

  if (!listing) {
    console.warn(`[geocode] Listing ${listingId} not found, skipping`);
    return;
  }

  // Skip if already geocoded
  if (listing.latitude != null && listing.longitude != null) {
    return;
  }

  if (!listing.address) {
    console.log(`[geocode] No address for listing ${listingId}, skipping`);
    return;
  }

  // Build address string — include borough for disambiguation
  const addressStr = listing.borough
    ? `${listing.address}, ${listing.borough}`
    : listing.address;

  const coords = await geocodeAddress(addressStr);

  if (!coords) {
    console.log(`[geocode] No result for: "${addressStr}"`);
    return;
  }

  await prisma.normalizedListing.update({
    where: { id: listingId },
    data: { latitude: coords.lat, longitude: coords.lon },
  });

  console.log(`[geocode] ${listing.address} → ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`);

  // Phase 3 will add: enqueue analyze-neighborhood here
}

export function startGeocodeWorker(): Worker<GeocodeJobData> {
  const worker = new Worker<GeocodeJobData>("geocode-listing", processGeocode, {
    connection,
    concurrency: 1,
    // Nominatim ToS: max 1 request/sec
    limiter: { max: 1, duration: 1100 },
  });

  worker.on("completed", (j) => console.log(`[geocode] Job ${j.id} done`));
  worker.on("failed", (j, err) => console.warn(`[geocode] Job ${j?.id} failed: ${err.message}`));

  return worker;
}

// scripts/seedSubwayStations.ts
// Seed SubwayStation table from NYC Open Data subway stations endpoint.
// Source: https://data.cityofnewyork.us/resource/i9wp-a4ja.json
// Safe to re-run: uses upsert on station ID.
//
// Usage: npx tsx scripts/seedSubwayStations.ts

import "dotenv/config";
import { PrismaClient } from "../node_modules/.prisma/client/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter } as never);

interface NycStation {
  complex_id: string;
  stop_name: string;
  daytime_routes: string;  // e.g. "A C E"
  latitude: string;
  longitude: string;
}

async function main() {
  console.log("Fetching NYC subway stations from NY State Open Data…");

  // MTA Subway Stations and Complexes (data.ny.gov id: 5f5g-n3cz)
  const url =
    "https://data.ny.gov/resource/5f5g-n3cz.json" +
    "?$limit=500&$select=complex_id,stop_name,daytime_routes,latitude,longitude";

  const res = await fetch(url, {
    headers: { "Accept": "application/json" },
  });

  if (!res.ok) throw new Error(`NYC Open Data HTTP ${res.status}`);

  const stations: NycStation[] = await res.json();
  console.log(`Fetched ${stations.length} stations`);

  let upserted = 0;
  let skipped = 0;

  for (const s of stations) {
    const lat = parseFloat(s.latitude);
    const lon = parseFloat(s.longitude);

    if (isNaN(lat) || isNaN(lon)) { skipped++; continue; }

    // Parse "A C E" or "6" → ["A","C","E"] or ["6"]
    const lines = (s.daytime_routes ?? "")
      .split(/[\s,]+/)
      .map((l: string) => l.trim().toUpperCase())
      .filter(Boolean);

    await (prisma as any).subwayStation.upsert({
      where: { id: s.complex_id },
      create: { id: s.complex_id, name: s.stop_name, lines, latitude: lat, longitude: lon },
      update: { name: s.stop_name, lines, latitude: lat, longitude: lon },
    });

    upserted++;
  }

  console.log(`Done. Upserted ${upserted} stations, skipped ${skipped} (missing coords).`);
  await (prisma as any).$disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });

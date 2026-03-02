import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOrCreateDevice, getDeviceIdCookieOptions } from "@/lib/device";
import { passesHardFilters, scoreListing } from "@/lib/recs/score";
import { getMatchReasons } from "@/lib/recs/reasons";
import type { PrefsForScoring, ListingForScoring, WeightsProfile } from "@/lib/recs/types";

const IMPRESSION_COOLDOWN_HOURS = 6;
const RECOMMENDED_PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") ?? "search";
    const debug = searchParams.get("debug") === "1";
    const q = searchParams.get("q")?.trim() ?? "";
    const source = searchParams.get("source")?.trim();
    const minPrice = searchParams.get("minPrice")?.trim();
    const maxPrice = searchParams.get("maxPrice")?.trim();
    const neighborhood = searchParams.get("neighborhood")?.trim();
    const limit = Math.min(500, parseInt(searchParams.get("limit") ?? "50", 10) || 50);

    if (mode === "recommended") {
      const { deviceId, isNew } = await getOrCreateDevice();
      const prefsRow = await prisma.preference.findUnique({ where: { deviceId } });
      if (!prefsRow) {
        const res = NextResponse.json(
          { error: "No preferences set. Complete onboarding first.", listings: [] },
          { status: 200 }
        );
        if (isNew) res.cookies.set("hid", deviceId, getDeviceIdCookieOptions());
        return res;
      }

      const prefs: PrefsForScoring = {
        minPrice: prefsRow.minPrice,
        maxPrice: prefsRow.maxPrice,
        beds: (prefsRow.beds as number[]) ?? [],
        neighborhoods: (prefsRow.neighborhoods as string[]) ?? [],
        amenities: (prefsRow.amenities as string[]) ?? [],
      };

      const profileRow = await prisma.deviceProfile.findUnique({ where: { deviceId } });
      const weights: WeightsProfile | null = profileRow?.weights
        ? (profileRow.weights as WeightsProfile)
        : null;

      const rawListings = await prisma.normalizedListing.findMany({
        where: { status: "active" },
        orderBy: { lastSeenAt: "desc" },
        take: Math.max(limit * 3, 200),
      });

      const forScoring: ListingForScoring[] = rawListings.map((l) => ({
        id: l.id,
        rentGross: l.rentGross,
        beds: l.beds,
        neighborhood: l.neighborhood,
        borough: l.borough,
        amenities: l.amenities,
        lastSeenAt: l.lastSeenAt,
        photos: l.photos,
        sqft: l.sqft,
        latitude: l.latitude,
        longitude: l.longitude,
        description: l.description,
        address: l.address,
        status: l.status,
      }));

      const filtered = forScoring.filter((l) => passesHardFilters(l, prefs));
      const withScores = filtered.map((l) => {
        const breakdown = scoreListing(l, prefs, weights);
        const reasons = getMatchReasons(l, prefs, breakdown);
        return { listing: l, breakdown, reasons };
      });
      withScores.sort((a, b) => {
        const diff = b.breakdown.total - a.breakdown.total;
        if (diff !== 0) return diff;
        return (
          new Date(b.listing.lastSeenAt).getTime() - new Date(a.listing.lastSeenAt).getTime()
        );
      });
      const top = withScores.slice(0, limit);
      const listingIds = top.map((x) => x.listing.id);
      const fullListings = await prisma.normalizedListing.findMany({
        where: { id: { in: listingIds } },
      });
      const byId = new Map(fullListings.map((l) => [l.id, l]));
      const ordered = listingIds
        .map((id) => byId.get(id))
        .filter(Boolean) as typeof fullListings;

      const sixHoursAgo = new Date(Date.now() - IMPRESSION_COOLDOWN_HOURS * 60 * 60 * 1000);
      const recentImpressions = await prisma.event.findMany({
        where: {
          deviceId,
          normalizedListingId: { in: listingIds.slice(0, RECOMMENDED_PAGE_SIZE) },
          type: "impression",
          createdAt: { gte: sixHoursAgo },
        },
        select: { normalizedListingId: true },
      });
      const alreadyLogged = new Set(recentImpressions.map((e) => e.normalizedListingId));
      const toLog = listingIds
        .slice(0, RECOMMENDED_PAGE_SIZE)
        .filter((id) => !alreadyLogged.has(id));

      for (const normalizedListingId of toLog) {
        try {
          await prisma.event.create({
            data: {
              deviceId,
              normalizedListingId,
              type: "impression",
              metadata: { rank: toLog.indexOf(normalizedListingId), mode: "recommended" },
            },
          });
        } catch (_) {
          // ignore duplicate or DB error
        }
      }

      const payload = ordered.map((l) => {
        const item = top.find((t) => t.listing.id === l.id);
        const score = item?.breakdown.total ?? 0;
        const reasons = item?.reasons ?? [];
        const out: Record<string, unknown> = {
          ...JSON.parse(JSON.stringify(l)),
          matchScore: score,
          matchReasons: reasons,
        };
        if (debug && item) {
          out.scoreBreakdown = item.breakdown;
        }
        return out;
      });

      const res = NextResponse.json(payload);
      if (isNew) res.cookies.set("hid", deviceId, getDeviceIdCookieOptions());
      return res;
    }

    const where: Record<string, unknown> = {};
    if (q) {
      where.OR = [
        { address: { contains: q, mode: "insensitive" } },
        { neighborhood: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { borough: { contains: q, mode: "insensitive" } },
        { sourceUrl: { contains: q, mode: "insensitive" } },
      ];
    }
    if (source) where.source = source;
    if (minPrice || maxPrice) {
      const priceFilter: { gte?: number; lte?: number } = {};
      if (minPrice) priceFilter.gte = parseInt(minPrice, 10);
      if (maxPrice) priceFilter.lte = parseInt(maxPrice, 10);
      where.rentGross = priceFilter;
    }
    if (neighborhood) where.neighborhood = { contains: neighborhood, mode: "insensitive" };

    const [listings, total] = await Promise.all([
      prisma.normalizedListing.findMany({
        where,
        orderBy: { lastScrapedAt: "desc" },
        take: limit,
      }),
      prisma.normalizedListing.count({ where }),
    ]);

    // Batch-fetch sibling postings for cross-source dedup badges
    const canonicalIds = [
      ...new Set(
        listings.map((l) => l.canonicalUnitId).filter((id): id is string => id != null)
      ),
    ];
    const siblingMap = new Map<string, string[]>(); // canonicalUnitId → source[]
    if (canonicalIds.length > 0) {
      const siblings = await prisma.normalizedListing.findMany({
        where: { canonicalUnitId: { in: canonicalIds }, status: "active" },
        select: { canonicalUnitId: true, source: true },
      });
      for (const s of siblings) {
        if (!s.canonicalUnitId) continue;
        if (!siblingMap.has(s.canonicalUnitId)) siblingMap.set(s.canonicalUnitId, []);
        siblingMap.get(s.canonicalUnitId)!.push(s.source);
      }
    }

    const payload = listings.map((l) => {
      const allSources = l.canonicalUnitId ? (siblingMap.get(l.canonicalUnitId) ?? []) : [];
      const otherSources = [...new Set(allSources.filter((s) => s !== l.source))];
      return { ...l, siblingCount: otherSources.length, otherSources };
    });

    return NextResponse.json({ listings: payload, total });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed to fetch listings" }, { status: 500 });
  }
}

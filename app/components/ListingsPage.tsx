"use client";

import { useEffect, useState } from "react";

type Listing = {
  id: string;
  source: string;
  url: string;
  title: string | null;
  address: string | null;
  neighborhood: string | null;
  borough: string | null;
  price: number | null;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  photos: unknown;
  lastScrapedAt: string;
  matchScore?: number;
  matchReasons?: string[];
};

const PLACEHOLDERS = [
  "linear-gradient(135deg, #E8E0D5 0%, #D4C9B8 100%)",
  "linear-gradient(135deg, #DDE2DD 0%, #C5D0C5 100%)",
  "linear-gradient(135deg, #E2DDD8 0%, #C8BBB0 100%)",
  "linear-gradient(135deg, #D8DCE2 0%, #B8C0CC 100%)",
  "linear-gradient(135deg, #E0D8E2 0%, #C4B8CC 100%)",
];

function placeholderFor(listing: Listing) {
  const seed = (listing.neighborhood ?? listing.source ?? "").length;
  return PLACEHOLDERS[seed % PLACEHOLDERS.length];
}

function trackEvent(listingId: string, type: "click" | "save" | "hide") {
  fetch("/api/events", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listingId, type }),
  }).catch(() => {});
}

function ListingCard({
  listing,
  index,
  onSave,
  onHide,
  showActions,
}: {
  listing: Listing;
  index: number;
  onSave?: (id: string) => void;
  onHide?: (id: string) => void;
  showActions?: boolean;
}) {
  const photos = Array.isArray(listing.photos) ? (listing.photos as string[]) : [];
  const photo = photos[0] ?? null;
  const [imgFailed, setImgFailed] = useState(false);

  const initials = (listing.neighborhood ?? listing.address ?? "NYC")
    .replace(/[^a-zA-Z\s]/g, "")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");

  return (
    <div
      className="group block bg-[var(--card)] rounded-xl overflow-hidden border border-[var(--border)] hover:border-[var(--accent)] hover:shadow-lg transition-all duration-300 animate-fade-up"
      style={{ animationDelay: `${Math.min(index * 35, 400)}ms` }}
    >
    <a
      href={`/listings/${listing.id}`}
      className="block"
      onClick={() => trackEvent(listing.id, "click")}
    >
      {/* Photo */}
      <div className="relative aspect-[4/3] overflow-hidden bg-[var(--surface)]">
        {photo && !imgFailed ? (
          <img
            src={photo}
            alt={listing.address ?? "Listing photo"}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ background: placeholderFor(listing) }}
          >
            <span className="font-serif text-5xl font-semibold text-[#B0A89E] select-none">
              {initials || "NYC"}
            </span>
          </div>
        )}
        <span className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm text-[var(--muted)] text-[10px] font-medium uppercase tracking-widest px-2.5 py-1 rounded-full border border-[var(--border)]">
          {listing.source}
        </span>
      </div>

      {/* Body */}
      <div className="p-4">
        {listing.price != null && (
          <p className="font-serif text-2xl font-semibold text-[var(--accent)] leading-none mb-2.5">
            ${listing.price.toLocaleString()}
            <span className="text-sm font-sans font-normal text-[var(--muted-light)] ml-1">/mo</span>
          </p>
        )}

        <p className="text-sm font-medium text-[var(--foreground)] leading-snug line-clamp-1 mb-1">
          {listing.title ?? listing.address ?? "—"}
        </p>
        {listing.title && listing.address && (
          <p className="text-xs text-[var(--muted)] line-clamp-1 mb-2">{listing.address}</p>
        )}

        {(listing.neighborhood || listing.borough) && (
          <div className="flex flex-wrap gap-1 mb-3">
            {listing.neighborhood && (
              <span className="text-xs bg-[var(--surface)] text-[var(--muted)] px-2 py-0.5 rounded-full">
                {listing.neighborhood}
              </span>
            )}
            {listing.borough && listing.borough !== listing.neighborhood && (
              <span className="text-xs bg-[var(--surface)] text-[var(--muted)] px-2 py-0.5 rounded-full">
                {listing.borough}
              </span>
            )}
          </div>
        )}

        {(listing.beds != null || listing.baths != null || listing.sqft != null) && (
          <div className="flex items-center gap-3 text-xs text-[var(--muted)] border-t border-[var(--border)] pt-3">
            {listing.beds != null && (
              <span>{listing.beds} {listing.beds === 1 ? "bed" : "beds"}</span>
            )}
            {listing.baths != null && (
              <span>{listing.baths} {listing.baths === 1 ? "bath" : "baths"}</span>
            )}
            {listing.sqft != null && (
              <span>{listing.sqft.toLocaleString()} sqft</span>
            )}
          </div>
        )}
        {listing.matchReasons && listing.matchReasons.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {listing.matchReasons.slice(0, 3).map((r) => (
              <span key={r} className="text-[10px] bg-[var(--accent-light)] text-[var(--accent)] px-2 py-0.5 rounded-full">
                {r}
              </span>
            ))}
          </div>
        )}
      </div>
    </a>
    {showActions && (
      <div className="flex items-center gap-2 px-4 pb-4" onClick={(e) => e.preventDefault()}>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); trackEvent(listing.id, "save"); onSave?.(listing.id); }}
          className="text-xs font-medium text-[var(--muted)] hover:text-[var(--accent)] transition-colors"
        >
          Save
        </button>
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); trackEvent(listing.id, "hide"); onHide?.(listing.id); }}
          className="text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        >
          Hide
        </button>
      </div>
    )}
    </div>
  );
}

type ListMode = "search" | "recommended";

export function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [mode, setMode] = useState<ListMode>("search");
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [loading, setLoading] = useState(true);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/sources")
      .then((r) => r.json())
      .then(setSources)
      .catch(console.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    if (mode === "recommended") {
      fetch("/api/listings?mode=recommended&limit=50", { credentials: "include" })
        .then((r) => r.json())
        .then((data) => setListings(Array.isArray(data) ? data : (data?.listings ?? [])))
        .catch(console.error)
        .finally(() => setLoading(false));
    } else {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (source) params.set("source", source);
      if (minPrice) params.set("minPrice", minPrice);
      if (maxPrice) params.set("maxPrice", maxPrice);
      params.set("limit", "50");
      fetch(`/api/listings?${params}`)
        .then((r) => r.json())
        .then(setListings)
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [mode, q, source, minPrice, maxPrice]);

  const visibleListings = listings.filter((l) => !hiddenIds.has(l.id));

  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10">
      {/* Page header + mode toggle */}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-4xl sm:text-5xl font-semibold text-[var(--foreground)] mb-1">
            NYC Apartments
          </h1>
          <p className="text-sm text-[var(--muted)]">
            {loading ? "Loading…" : `${visibleListings.length} listing${visibleListings.length !== 1 ? "s" : ""} found`}
          </p>
        </div>
        <div className="flex rounded-lg border border-[var(--border)] p-0.5 bg-[var(--surface)]">
          <button
            type="button"
            onClick={() => setMode("recommended")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${mode === "recommended" ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
          >
            For You
          </button>
          <button
            type="button"
            onClick={() => setMode("search")}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${mode === "search" ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--foreground)]"}`}
          >
            Search
          </button>
        </div>
      </div>

      {/* Filters (only in search mode) */}
      {mode === "search" && (
      <div className="mb-8 p-5 bg-[var(--card)] border border-[var(--border)] rounded-xl flex flex-wrap gap-4 items-end shadow-sm">
        <label className="flex-1 min-w-[200px]">
          <span className="block text-[10px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">
            Search
          </span>
          <input
            type="search"
            placeholder="Address, neighborhood…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition"
          />
        </label>

        <label>
          <span className="block text-[10px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">
            Source
          </span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition"
          >
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>

        <div className="flex gap-2 items-end">
          <label>
            <span className="block text-[10px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">
              Min $
            </span>
            <input
              type="number"
              placeholder="0"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              className="w-24 px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition"
            />
          </label>
          <span className="text-[var(--muted-light)] pb-2.5 text-sm">–</span>
          <label>
            <span className="block text-[10px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">
              Max $
            </span>
            <input
              type="number"
              placeholder="any"
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="w-24 px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition"
            />
          </label>
        </div>
      </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="bg-[var(--card)] rounded-xl border border-[var(--border)] overflow-hidden animate-pulse"
            >
              <div className="aspect-[4/3] bg-[var(--surface)]" />
              <div className="p-4 space-y-3">
                <div className="h-6 bg-[var(--surface)] rounded-md w-2/5" />
                <div className="h-4 bg-[var(--surface)] rounded-md w-3/4" />
                <div className="h-3 bg-[var(--surface)] rounded-md w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : visibleListings.length === 0 ? (
        <div className="text-center py-28">
          <p className="font-serif text-3xl text-[var(--muted)] mb-2">No listings found</p>
          <p className="text-sm text-[var(--muted-light)]">
            {mode === "recommended" ? "Complete onboarding to get personalized recommendations." : "Try adjusting your search filters"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleListings.map((listing, i) => (
            <ListingCard
              key={listing.id}
              listing={listing}
              index={i}
              showActions={mode === "recommended"}
              onHide={(id) => setHiddenIds((prev) => new Set(prev).add(id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

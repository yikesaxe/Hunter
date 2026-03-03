"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-[var(--surface)] animate-pulse" />,
});

// ── Types ─────────────────────────────────────────────────────────────────────

type ListingAnalysis = {
  summary: string | null;
  priceTier: string | null;
  redFlags: unknown;
};

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
  latitude: number | null;
  longitude: number | null;
  matchScore?: number;
  matchReasons?: string[];
  siblingCount?: number;
  otherSources?: string[];
  analysis?: ListingAnalysis | null;
};

type ListMode = "search" | "recommended";
type SortMode = "match" | "value" | "space";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function parsePhotos(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}


function getListingTags(listing: Listing): string[] {
  const tags: string[] = [];
  if (listing.analysis?.priceTier === "below_market") tags.push("Below market");
  if ((listing.siblingCount ?? 0) > 0) tags.push(`+${listing.siblingCount} sources`);
  if (listing.sqft) tags.push(`${listing.sqft.toLocaleString()} sqft`);
  return tags;
}

// ── HeartIcon ─────────────────────────────────────────────────────────────────

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

// ── ListingCard ───────────────────────────────────────────────────────────────

function ListingCard({
  listing,
  index,
  onSave,
  onHide,
  onSaveToggle,
  showActions,
  isSaved,
  isHovered,
  onHoverChange,
  compact,
}: {
  listing: Listing;
  index: number;
  onSave?: (id: string) => void;
  onHide?: (id: string) => void;
  onSaveToggle?: (id: string) => void;
  showActions?: boolean;
  isSaved?: boolean;
  isHovered?: boolean;
  onHoverChange?: (hovered: boolean) => void;
  compact?: boolean;
}) {
  const photos = parsePhotos(listing.photos);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [failedSet, setFailedSet] = useState<Set<number>>(new Set());
  const [imgOpacity, setImgOpacity] = useState(1);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentPhoto = photos[photoIdx] ?? null;
  const isCurrentFailed = failedSet.has(photoIdx);
  const showImage = currentPhoto !== null && !isCurrentFailed;

  const navigate = (dir: 1 | -1, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (photos.length <= 1) return;
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    setImgOpacity(0.35);
    fadeTimer.current = setTimeout(() => {
      setPhotoIdx((i) => (i + dir + photos.length) % photos.length);
      setImgOpacity(1);
    }, 110);
  };

  const goTo = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (i === photoIdx) return;
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    setImgOpacity(0.35);
    fadeTimer.current = setTimeout(() => {
      setPhotoIdx(i);
      setImgOpacity(1);
    }, 110);
  };

  const initials = (listing.neighborhood ?? listing.address ?? "NYC")
    .replace(/[^a-zA-Z\s]/g, "").trim().split(" ").filter(Boolean)
    .slice(0, 2).map((w) => w[0].toUpperCase()).join("");

  const tags = getListingTags(listing);

  const subline = [
    listing.beds != null ? `${listing.beds} ${listing.beds === 1 ? "bed" : "beds"}` : null,
    listing.baths != null ? `${listing.baths} ${listing.baths === 1 ? "bath" : "baths"}` : null,
    listing.neighborhood,
  ].filter(Boolean).join(" · ");

  return (
    <div
      className={`group bg-[var(--card)] rounded-2xl overflow-hidden border transition-all duration-300 animate-fade-up flex flex-col ${
        isHovered
          ? "border-[var(--accent)] shadow-[0_4px_24px_rgba(194,125,58,0.18)] ring-1 ring-[var(--accent)]/20"
          : "border-[var(--border)] hover:border-[var(--accent)]/60 hover:shadow-lg"
      }`}
      style={{ animationDelay: `${Math.min(index * 30, 360)}ms` }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      {/* ── Photo area ── */}
      <a
        href={`/listings/${listing.id}`}
        className="block relative overflow-hidden bg-[var(--surface)] flex-shrink-0"
        style={{ aspectRatio: compact ? "16/10" : "4/3" }}
        onClick={() => trackEvent(listing.id, "click")}
      >
        {showImage ? (
          <img
            src={currentPhoto}
            alt={listing.address ?? "Listing photo"}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
            style={{
              opacity: imgOpacity,
              transform: imgOpacity < 1 ? "scale(1.02)" : "scale(1)",
              transition: "opacity 0.2s ease, transform 0.2s ease",
            }}
            onError={() => setFailedSet((s) => new Set(s).add(photoIdx))}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: placeholderFor(listing) }}>
            <span className="font-serif text-5xl font-semibold text-[#B0A89E] select-none">{initials || "NYC"}</span>
          </div>
        )}

        {/* Bottom gradient scrim */}
        <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />

        {/* Price badge — top right (replaces source label) */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          {(listing.siblingCount ?? 0) > 0 && (
            <span className="bg-[var(--accent)]/90 backdrop-blur-sm text-white text-[10px] font-semibold px-2 py-0.5 rounded-full shadow-sm">
              +{listing.siblingCount}
            </span>
          )}
          {listing.price != null ? (
            <span className="bg-white/95 backdrop-blur-sm text-[var(--foreground)] text-[11.5px] font-semibold tabular-nums px-2.5 py-1 rounded-full border border-white/60 shadow-sm">
              ${listing.price.toLocaleString()}
              <span className="text-[var(--muted)] font-normal">/mo</span>
            </span>
          ) : (
            <span className="bg-white/90 backdrop-blur-sm text-[var(--muted)] text-[10px] font-medium uppercase tracking-widest px-2.5 py-1 rounded-full border border-white/60 shadow-sm">
              {listing.source}
            </span>
          )}
        </div>

        {/* Photo counter */}
        {photos.length > 1 && (
          <span className="absolute top-3 left-3 bg-black/45 backdrop-blur-sm text-white text-[10px] font-medium tabular-nums px-2 py-0.5 rounded-full">
            {photoIdx + 1}/{photos.length}
          </span>
        )}

        {/* Prev/Next arrows */}
        {photos.length > 1 && (
          <>
            <button type="button" aria-label="Previous photo" onClick={(e) => navigate(-1, e)}
              className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 backdrop-blur-sm shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white transition-all duration-200 hover:scale-110">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button type="button" aria-label="Next photo" onClick={(e) => navigate(1, e)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/80 backdrop-blur-sm shadow-md flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white transition-all duration-200 hover:scale-110">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </>
        )}

        {/* Dot indicators */}
        {photos.length > 1 && photos.length <= 10 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 ml-16">
            {photos.map((_, i) => (
              <button key={i} type="button" aria-label={`Photo ${i + 1}`} onClick={(e) => goTo(i, e)}
                className="transition-all duration-200"
                style={{
                  width: i === photoIdx ? "14px" : "5px",
                  height: "5px",
                  borderRadius: "3px",
                  background: i === photoIdx ? "white" : "rgba(255,255,255,0.5)",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
                }}
              />
            ))}
          </div>
        )}
      </a>

      {/* ── Card body ── */}
      <div className="flex flex-col flex-1 p-4">
        <a href={`/listings/${listing.id}`} onClick={() => trackEvent(listing.id, "click")}>
          {/* Address */}
          <h3 className="font-semibold text-[var(--foreground)] text-[0.875rem] leading-snug mb-0.5 line-clamp-1">
            {listing.address ?? listing.title ?? "—"}
          </h3>

          {/* Beds · Bath · Neighborhood */}
          {subline && (
            <p className="text-xs text-[var(--muted)] mb-2.5 leading-relaxed">{subline}</p>
          )}

          {/* AI summary */}
          {listing.analysis?.summary && (
            <p className="text-xs text-[var(--muted)] italic mb-3 leading-relaxed line-clamp-2">
              {listing.analysis.summary}
            </p>
          )}
        </a>

        {/* Tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {tags.map((tag) => (
              <span key={tag} className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                tag === "Below market"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                  : "bg-[var(--surface)] text-[var(--muted)]"
              }`}>
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Red flags — clean, not alarming */}
        {(() => {
          const flags = Array.isArray(listing.analysis?.redFlags) ? listing.analysis!.redFlags as string[] : [];
          return flags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {flags.slice(0, 1).map((flag) => (
                <span key={flag} className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-100">
                  Note: {flag.length > 45 ? flag.slice(0, 43) + "…" : flag}
                </span>
              ))}
            </div>
          ) : null;
        })()}

        {/* spacer to push actions to bottom */}
        <div className="flex-1" />


        {/* ── Actions ── */}
        {showActions ? (
          // Recommended mode: Save + Hide
          <div className="flex items-center gap-3 pt-3 mt-2 border-t border-[var(--border)]">
            <button type="button"
              onClick={(e) => { e.stopPropagation(); trackEvent(listing.id, "save"); onSave?.(listing.id); }}
              className="text-xs font-medium text-[var(--muted)] hover:text-[var(--accent)] transition-colors">
              Save
            </button>
            <button type="button"
              onClick={(e) => { e.stopPropagation(); trackEvent(listing.id, "hide"); onHide?.(listing.id); }}
              className="text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
              Hide
            </button>
          </div>
        ) : (
          // Search mode: Save ♥ + Details →
          <div className="flex items-center justify-between pt-3 mt-2 border-t border-[var(--border)]">
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSaveToggle?.(listing.id); trackEvent(listing.id, "save"); }}
              className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                isSaved ? "text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--accent)]"
              }`}
            >
              <HeartIcon filled={!!isSaved} />
              {isSaved ? "Saved" : "Save"}
            </button>
            <a
              href={`/listings/${listing.id}`}
              onClick={() => trackEvent(listing.id, "click")}
              className="flex items-center gap-1 text-xs font-medium text-[var(--foreground)] hover:text-[var(--accent)] transition-colors"
            >
              Details
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

// ── MapInsightCard ────────────────────────────────────────────────────────────

function MapInsightCard({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute bottom-8 right-4 z-10 w-[260px] bg-[#2B2520] text-white rounded-2xl p-4 shadow-2xl animate-slide-up">
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 text-white/40 hover:text-white/80 transition-colors text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
      <div className="flex items-start gap-2.5 mb-3 pr-4">
        <span className="text-[1.1rem] mt-0.5">🏠</span>
        <p className="text-[13px] leading-snug text-white/90">
          Better value spotted in <strong className="text-white">Harlem</strong> today. Want to see?
        </p>
      </div>
      <button
        type="button"
        className="w-full py-2 rounded-xl bg-[var(--accent-light)] text-[var(--accent)] text-xs font-semibold hover:bg-[var(--accent)] hover:text-white transition-colors"
      >
        Check it out
      </button>
    </div>
  );
}

// ── Saved Tray ────────────────────────────────────────────────────────────────

function SavedTray({ count, onClear }: { count: number; onClear: () => void }) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pb-4 px-4 pointer-events-none">
      <div className="pointer-events-auto animate-tray-in bg-[var(--card)] border border-[var(--border)] rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-5 max-w-lg w-full">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="var(--accent)" stroke="var(--accent)" />
          </svg>
          {count} Saved
        </div>
        <div className="h-4 w-px bg-[var(--border)]" />
        <button type="button" className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
          Compare
        </button>
        <button
          type="button"
          onClick={onClear}
          className="ml-auto text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
        >
          Clear
        </button>
        <a
          href="/"
          className="flex items-center gap-1.5 px-4 py-2 bg-[var(--accent)] text-white text-xs font-semibold rounded-xl hover:bg-[var(--accent-hover)] transition-colors"
        >
          View Saved
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
        </a>
      </div>
    </div>
  );
}

// ── ListingsPage ──────────────────────────────────────────────────────────────

const PROMPT_CHIPS = [
  "No fee, laundry, good for roommates",
  "Find me the best deals in Williamsburg",
  "Quiet 1BR near a park, pet-friendly",
];

const SORT_OPTIONS: { key: SortMode; label: string }[] = [
  { key: "match", label: "Best Match" },
  { key: "value", label: "Best Value" },
  { key: "space", label: "Most Space" },
];

export function ListingsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [limit, setLimit] = useState(50);
  const [sources, setSources] = useState<string[]>([]);
  const [mode, setMode] = useState<ListMode>("search");
  const [q, setQ] = useState("");
  const [source, setSource] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [hoveredListingId, setHoveredListingId] = useState<string | null>(null);
  const cardRefsMap = useRef<Map<string, HTMLDivElement>>(new Map());
  const hoverSourceRef = useRef<"card" | "map">("card");
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>("match");
  const [showFilters, setShowFilters] = useState(false);
  const [showInsight, setShowInsight] = useState(true);
  const [inputFocused, setInputFocused] = useState(false);

  useEffect(() => {
    fetch("/api/sources").then((r) => r.json()).then(setSources).catch(console.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    setLimit(50);
  }, [mode, q, source, minPrice, maxPrice]);

  useEffect(() => {
    if (mode === "recommended") {
      fetch("/api/listings?mode=recommended&limit=50", { credentials: "include" })
        .then((r) => r.json())
        .then((data) => {
          const arr = Array.isArray(data) ? data : (data?.listings ?? []);
          setListings(arr);
          setTotal(data?.total ?? arr.length);
        })
        .catch(console.error)
        .finally(() => { setLoading(false); setLoadingMore(false); });
    } else {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (source) params.set("source", source);
      if (minPrice) params.set("minPrice", minPrice);
      if (maxPrice) params.set("maxPrice", maxPrice);
      params.set("limit", String(limit));
      fetch(`/api/listings?${params}`)
        .then((r) => r.json())
        .then((data) => {
          setListings(data.listings ?? data);
          setTotal(data.total ?? (data.listings ?? data).length);
        })
        .catch(console.error)
        .finally(() => { setLoading(false); setLoadingMore(false); });
    }
  }, [mode, q, source, minPrice, maxPrice, limit]);

  const handleNeighborhoodToggle = useCallback((ntaname: string) => {
    setSelectedNeighborhoods((prev) => {
      const next = new Set(prev);
      next.has(ntaname) ? next.delete(ntaname) : next.add(ntaname);
      return next;
    });
  }, []);

  const handleSaveToggle = useCallback((id: string) => {
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // When a map pin is hovered, scroll the corresponding card into view
  useEffect(() => {
    if (!hoveredListingId || hoverSourceRef.current !== "map") return;
    const el = cardRefsMap.current.get(hoveredListingId);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [hoveredListingId]);

  // Apply neighborhood filter
  const neighborhoodFiltered = listings
    .filter((l) => !hiddenIds.has(l.id))
    .filter((l) => {
      if (selectedNeighborhoods.size === 0) return true;
      return [...selectedNeighborhoods].some((nta) =>
        nta.split(/[-–,]/).some((part) =>
          l.neighborhood?.toLowerCase().includes(part.trim().toLowerCase())
        )
      );
    });

  // Apply client-side sort
  const visibleListings = [...neighborhoodFiltered].sort((a, b) => {
    if (sortMode === "value") return (a.price ?? Infinity) - (b.price ?? Infinity);
    if (sortMode === "space") {
      if (a.sqft && b.sqft) return b.sqft - a.sqft;
      return (b.beds ?? 0) - (a.beds ?? 0);
    }
    // "match" — sort by matchScore, then default order
    return (b.matchScore ?? 0) - (a.matchScore ?? 0);
  });

  const hasMore = mode === "search" && listings.length < total;

  const mapListings = listings
    .filter((l) => l.latitude != null && l.longitude != null)
    .map((l) => ({
      id: l.id,
      latitude: l.latitude!,
      longitude: l.longitude!,
      price: l.price,
      neighborhood: l.neighborhood,
    }));

  // Build preference summary chips
  const prefChips: string[] = [];
  if (minPrice || maxPrice) {
    prefChips.push(`Budget: ${minPrice ? `$${Number(minPrice).toLocaleString()}` : "—"} – ${maxPrice ? `$${Number(maxPrice).toLocaleString()}` : "any"}`);
  }
  if (selectedNeighborhoods.size > 0) {
    const areas = [...selectedNeighborhoods].slice(0, 2).join(", ");
    const extra = selectedNeighborhoods.size > 2 ? ` +${selectedNeighborhoods.size - 2}` : "";
    prefChips.push(`Areas: ${areas}${extra}`);
  }
  if (source) prefChips.push(`Source: ${source}`);

  // ── For You mode: original layout ──────────────────────────────────────────
  if (mode !== "search") {
    return (
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10">
        {/* Header */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="font-serif text-4xl sm:text-5xl font-semibold text-[var(--foreground)] mb-1">
              For You
            </h1>
            <p className="text-sm text-[var(--muted)]">
              {loading ? "Loading…" : `${total.toLocaleString()} listing${total !== 1 ? "s" : ""} matched`}
            </p>
          </div>
          <div className="flex rounded-lg border border-[var(--border)] p-0.5 bg-[var(--surface)]">
            <button type="button" onClick={() => setMode("recommended")}
              className="px-4 py-2 text-sm font-medium rounded-md transition-colors bg-[var(--card)] text-[var(--foreground)] shadow-sm">
              For You
            </button>
            <button type="button" onClick={() => setMode("search")}
              className="px-4 py-2 text-sm font-medium rounded-md transition-colors text-[var(--muted)] hover:text-[var(--foreground)]">
              Search
            </button>
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-[var(--card)] rounded-2xl border border-[var(--border)] overflow-hidden animate-pulse">
                <div className="aspect-[4/3] bg-[var(--surface)]" />
                <div className="p-4 space-y-3">
                  <div className="h-5 bg-[var(--surface)] rounded w-2/5" />
                  <div className="h-3.5 bg-[var(--surface)] rounded w-3/4" />
                  <div className="h-3 bg-[var(--surface)] rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : visibleListings.length === 0 ? (
          <div className="text-center py-28">
            <p className="font-serif text-3xl text-[var(--muted)] mb-2">No recommendations yet</p>
            <p className="text-sm text-[var(--muted-light)]">Complete onboarding to get personalized picks.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {visibleListings.map((l, i) => (
              <ListingCard key={l.id} listing={l} index={i} showActions
                onHide={(id) => setHiddenIds((prev) => new Set(prev).add(id))}
                isHovered={hoveredListingId === l.id}
                onHoverChange={(h) => setHoveredListingId(h ? l.id : null)}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Search mode: split view ─────────────────────────────────────────────────
  return (
    <>
      <div className="flex h-[calc(100vh-56px)]">
        {/* LEFT: scrollable listings panel */}
        <div className="w-full md:w-[54%] overflow-y-auto flex-shrink-0 border-r border-[var(--border)]">
          <div className="px-5 pt-6 pb-8">

            {/* ── Mode toggle (small, top) ── */}
            <div className="flex items-center justify-between mb-5">
              <div className="inline-flex rounded-lg border border-[var(--border)] p-0.5 bg-[var(--surface)]">
                <button type="button" onClick={() => setMode("recommended")}
                  className="px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors text-[var(--muted)] hover:text-[var(--foreground)]">
                  For You
                </button>
                <button type="button" onClick={() => setMode("search")}
                  className="px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors bg-[var(--card)] text-[var(--foreground)] shadow-sm">
                  Search
                </button>
              </div>
              <p className="text-xs text-[var(--muted)]">
                {loading ? "Loading…" : `${visibleListings.length.toLocaleString()} listings`}
              </p>
            </div>

            {/* ── AI Hero Search ── */}
            <div className="mb-5">
              <h2 className="font-serif text-[1.45rem] font-semibold text-[var(--foreground)] text-center mb-3 leading-snug">
                Tell Hunter what you're looking for…
              </h2>

              {/* Search input */}
              <div className={`relative flex items-center bg-[var(--card)] border-2 rounded-xl shadow-sm transition-all duration-200 ${
                inputFocused ? "border-[var(--accent)] shadow-[0_0_0_3px_rgba(194,125,58,0.12)]" : "border-[var(--border)]"
              }`}>
                <svg className="absolute left-4 text-[var(--muted-light)] shrink-0" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="2BR under $3,500 near Central Park…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  className="w-full pl-10 pr-4 py-3 text-sm bg-transparent text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none rounded-xl"
                />
                {q && (
                  <button type="button" onClick={() => setQ("")}
                    className="absolute right-3 text-[var(--muted-light)] hover:text-[var(--muted)] transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                )}
              </div>

              {/* Prompt chips */}
              <div className="flex flex-wrap gap-2 mt-2.5">
                {PROMPT_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setQ(chip)}
                    className="flex items-center gap-1 text-[11px] text-[var(--muted)] border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 rounded-full hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
                  >
                    {chip}
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Advanced filters (collapsible) ── */}
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setShowFilters((v) => !v)}
                className="flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="11" y1="18" x2="13" y2="18" />
                </svg>
                Advanced filters
                <span className={`transition-transform duration-150 ${showFilters ? "rotate-180" : ""}`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
                </span>
              </button>

              {showFilters && (
                <div className="mt-3 p-4 bg-[var(--card)] border border-[var(--border)] rounded-xl flex flex-wrap gap-3 items-end animate-fade-in">
                  <label>
                    <span className="block text-[10px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">Source</span>
                    <select value={source} onChange={(e) => setSource(e.target.value)}
                      className="px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition">
                      <option value="">All sources</option>
                      {sources.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  <div className="flex gap-2 items-end">
                    <label>
                      <span className="block text-[10px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">Min $</span>
                      <input type="number" placeholder="0" value={minPrice} onChange={(e) => setMinPrice(e.target.value)}
                        className="w-20 px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition" />
                    </label>
                    <span className="text-[var(--muted-light)] pb-2.5 text-sm">–</span>
                    <label>
                      <span className="block text-[10px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-1.5">Max $</span>
                      <input type="number" placeholder="any" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}
                        className="w-20 px-3 py-2 text-sm border border-[var(--border)] rounded-lg bg-[var(--background)] text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition" />
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* ── Preference summary bar ── */}
            {prefChips.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 px-4 py-2.5 bg-[var(--card)] border border-[var(--border)] rounded-xl text-xs text-[var(--muted)]">
                {prefChips.map((chip, i) => (
                  <span key={chip} className="flex items-center gap-3">
                    {i > 0 && <span className="text-[var(--border)]">|</span>}
                    {chip}
                  </span>
                ))}
                <button type="button" onClick={() => { setMinPrice(""); setMaxPrice(""); setSource(""); setSelectedNeighborhoods(new Set()); }}
                  className="ml-auto text-[var(--muted-light)] hover:text-[var(--muted)] transition-colors text-[10px]">
                  Clear ×
                </button>
              </div>
            )}

            {/* ── AI summary + sort chips ── */}
            <div className="mb-4">
              {!loading && visibleListings.length > 0 && (
                <p className="text-sm text-[var(--foreground)] mb-3 leading-relaxed">
                  I found{" "}
                  <strong>{visibleListings.length.toLocaleString()}</strong> apartments.
                  {visibleListings.length > 3 && " Here are the "}
                  {visibleListings.length > 3 && <strong>top picks</strong>}
                  {visibleListings.length > 3 && " for your search."}
                </p>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {SORT_OPTIONS.map(({ key, label }) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSortMode(key)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border ${
                      sortMode === key
                        ? "bg-[var(--foreground)] text-[var(--card)] border-[var(--foreground)]"
                        : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Neighborhood chips ── */}
            {selectedNeighborhoods.size > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {[...selectedNeighborhoods].map((n) => (
                  <button key={n} type="button" onClick={() => handleNeighborhoodToggle(n)}
                    className="text-xs bg-[var(--accent-light)] text-[var(--accent)] px-3 py-1 rounded-full flex items-center gap-1.5 hover:opacity-80 transition-opacity border border-[var(--accent)]/20">
                    {n} <span className="opacity-60">×</span>
                  </button>
                ))}
                <button type="button" onClick={() => setSelectedNeighborhoods(new Set())}
                  className="text-xs text-[var(--muted)] hover:text-[var(--foreground)] transition-colors">
                  Clear all
                </button>
              </div>
            )}

            {/* ── Listing grid ── */}
            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="bg-[var(--card)] rounded-2xl border border-[var(--border)] overflow-hidden animate-pulse">
                    <div className="bg-[var(--surface)]" style={{ aspectRatio: "16/10" }} />
                    <div className="p-4 space-y-3">
                      <div className="h-4 bg-[var(--surface)] rounded w-3/4" />
                      <div className="h-3 bg-[var(--surface)] rounded w-1/2" />
                      <div className="h-3 bg-[var(--surface)] rounded w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : visibleListings.length === 0 ? (
              <div className="text-center py-20">
                <p className="font-serif text-2xl text-[var(--muted)] mb-2">No listings found</p>
                <p className="text-xs text-[var(--muted-light)]">Try broadening your search or clearing filters</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {visibleListings.map((l, i) => (
                    <div key={l.id} ref={(el) => { if (el) cardRefsMap.current.set(l.id, el); else cardRefsMap.current.delete(l.id); }}>
                    <ListingCard
                      listing={l}
                      index={i}
                      compact
                      isSaved={savedIds.has(l.id)}
                      onSaveToggle={handleSaveToggle}
                      isHovered={hoveredListingId === l.id}
                      onHoverChange={(h) => { hoverSourceRef.current = "card"; setHoveredListingId(h ? l.id : null); }}
                    />
                    </div>
                  ))}
                </div>
                {hasMore && (
                  <div className="mt-8 flex justify-center">
                    <button type="button" disabled={loadingMore}
                      onClick={() => { setLoadingMore(true); setLimit((l) => l + 50); }}
                      className="px-6 py-2.5 text-sm font-medium rounded-xl border border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-50">
                      {loadingMore ? "Loading…" : `Load more (${total - listings.length} remaining)`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* RIGHT: map panel */}
        <div className="hidden md:block flex-1 relative">
          <MapView
            listings={mapListings}
            hoveredListingId={hoveredListingId}
            selectedNeighborhoods={selectedNeighborhoods}
            onNeighborhoodToggle={handleNeighborhoodToggle}
            onPinHover={(id) => { hoverSourceRef.current = "map"; setHoveredListingId(id); }}
            onPinClick={(id) => { window.location.href = `/listings/${id}`; }}
          />
          {showInsight && <MapInsightCard onClose={() => setShowInsight(false)} />}
        </div>
      </div>

      {/* ── Sticky saved tray ── */}
      {savedIds.size > 0 && (
        <SavedTray count={savedIds.size} onClear={() => setSavedIds(new Set())} />
      )}
    </>
  );
}

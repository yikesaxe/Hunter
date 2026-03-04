"use client";

import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useRef, useState } from "react";

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
  amenities: string | null;
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

type AiSearchResult = {
  listings: Listing[];
  total: number;
  scrapeTriggered: boolean;
  runId: string | null;
  summary: string;
};

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
  // "Below market" is now shown as a photo badge — skip here to avoid duplication
  if ((listing.siblingCount ?? 0) > 0) tags.push(`+${listing.siblingCount} sources`);
  if (listing.sqft) tags.push(`${listing.sqft.toLocaleString()} sqft`);
  return tags;
}

// ── Listing badge (photo overlay, top-left) ───────────────────────────────────

type BadgeVariant = "no-fee" | "deal" | "new" | "ai-pick";
type ListingBadge = { label: string; variant: BadgeVariant };

function getListingBadge(listing: Listing, isAiResult?: boolean): ListingBadge | null {
  // Priority 1 — No Fee: highest financial signal
  const amenities = (listing.amenities ?? "").toLowerCase();
  if (amenities.includes("no fee")) return { label: "No Fee", variant: "no-fee" };

  // Priority 2 — Below Market: AI-confirmed pricing edge
  if (listing.analysis?.priceTier === "below_market") return { label: "Below Market", variant: "deal" };

  // Priority 3 — New: scraped within the last 48 hours
  const ageHours = (Date.now() - new Date(listing.lastScrapedAt).getTime()) / 3_600_000;
  if (ageHours < 48) return { label: "New", variant: "new" };

  // Priority 4 — AI Pick: surfaced by AI with strong match score
  if (isAiResult && (listing.matchScore ?? 0) >= 60) return { label: "AI Pick", variant: "ai-pick" };

  return null;
}

const BADGE_STYLES: Record<BadgeVariant, string> = {
  "no-fee":  "bg-emerald-700/88 text-white shadow-emerald-900/20",
  "deal":    "bg-[#1E3A2A]/90 text-emerald-100 shadow-green-900/20",
  "new":     "bg-[#1C2B4A]/90 text-sky-100 shadow-blue-900/20",
  "ai-pick": "bg-[var(--accent)]/90 text-white shadow-[var(--accent)]/20",
};

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
  isAiResult,
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
  isAiResult?: boolean;
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
  const badge = getListingBadge(listing, isAiResult);

  const subline = [
    listing.beds != null ? `${listing.beds} ${listing.beds === 1 ? "bed" : "beds"}` : null,
    listing.baths != null ? `${listing.baths} ${listing.baths === 1 ? "bath" : "baths"}` : null,
    listing.neighborhood,
  ].filter(Boolean).join(" · ");

  return (
    <div
      className={`group bg-[var(--card)] rounded-2xl overflow-hidden border transition-all duration-300 animate-fade-up flex flex-col ${
        isHovered
          ? "border-[var(--accent)]/60 shadow-[0_8px_32px_rgba(232,113,74,0.16)] ring-1 ring-[var(--accent)]/20"
          : "border-[var(--border)]/60 shadow-sm hover:shadow-xl hover:border-[var(--border)]"
      }`}
      style={{ animationDelay: `${Math.min(index * 30, 360)}ms` }}
      onMouseEnter={() => onHoverChange?.(true)}
      onMouseLeave={() => onHoverChange?.(false)}
    >
      {/* ── Photo area ── */}
      <a
        href={`/listings/${listing.id}`}
        className="block relative overflow-hidden bg-[var(--surface)] flex-shrink-0"
        style={{ aspectRatio: "4/3" }}
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

        {/* Quality badge — top left */}
        {badge && (
          <div className={`absolute top-3 left-3 flex items-center gap-1.5 backdrop-blur-sm px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-wide shadow-md ${BADGE_STYLES[badge.variant]}`}>
            {badge.variant === "new" && (
              <span className="w-1.5 h-1.5 rounded-full bg-sky-300 animate-pulse shrink-0" />
            )}
            {badge.variant === "ai-pick" && (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
                <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
              </svg>
            )}
            {badge.variant === "no-fee" && (
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {badge.variant === "deal" && (
              <span className="text-[8px] leading-none shrink-0">↓</span>
            )}
            {badge.label}
          </div>
        )}

        {/* Sibling count — top right (price moves to card body) */}
        {(listing.siblingCount ?? 0) > 0 && (
          <div className="absolute top-3 right-3">
            <span className="bg-black/50 backdrop-blur-sm text-white text-[10px] font-medium px-2 py-0.5 rounded-full shadow-sm">
              +{listing.siblingCount} sources
            </span>
          </div>
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

        {/* Photo counter — bottom left, only when multiple photos */}
        {photos.length > 1 && (
          <span className="absolute bottom-3 left-3 bg-black/45 backdrop-blur-sm text-white text-[10px] font-medium tabular-nums px-2 py-0.5 rounded-full">
            {photoIdx + 1}/{photos.length}
          </span>
        )}

        {/* Dot indicators — bottom center */}
        {photos.length > 1 && photos.length <= 10 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
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
      <div className="flex flex-col flex-1 px-4 pt-3.5 pb-4">
        <a href={`/listings/${listing.id}`} onClick={() => trackEvent(listing.id, "click")} className="flex-1">
          {/* Address */}
          <h3 className="font-semibold text-[var(--foreground)] text-[0.9rem] leading-snug mb-0.5 line-clamp-1">
            {listing.address ?? listing.title ?? "—"}
          </h3>

          {/* Beds · Bath · Neighborhood */}
          {subline && (
            <p className="text-[12.5px] text-[var(--muted)] mb-3 leading-relaxed">{subline}</p>
          )}

          {/* Price — prominent, Airbnb-style */}
          {listing.price != null && (
            <p className="text-[0.95rem] font-semibold text-[var(--foreground)] tabular-nums mb-2">
              ${listing.price.toLocaleString()}
              <span className="text-[var(--muted)] font-normal text-[0.8rem]"> /mo</span>
            </p>
          )}

          {/* AI summary — 1 line, subtle */}
          {listing.analysis?.summary && (
            <p className="text-[11.5px] text-[var(--muted-light)] italic leading-relaxed line-clamp-1 mb-2">
              {listing.analysis.summary}
            </p>
          )}
        </a>

        {/* Tags + red flags row */}
        {(tags.length > 0 || (() => { const f = Array.isArray(listing.analysis?.redFlags) ? listing.analysis!.redFlags as string[] : []; return f.length > 0; })()) && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {tags.map((tag) => (
              <span key={tag} className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-[var(--surface)] text-[var(--muted)]">
                {tag}
              </span>
            ))}
            {(() => {
              const flags = Array.isArray(listing.analysis?.redFlags) ? listing.analysis!.redFlags as string[] : [];
              return flags.slice(0, 1).map((flag) => (
                <span key={flag} className="text-[10px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full border border-amber-100">
                  ⚠ {flag.length > 38 ? flag.slice(0, 36) + "…" : flag}
                </span>
              ));
            })()}
          </div>
        )}

        {/* spacer */}
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

// ── FiltersModal ──────────────────────────────────────────────────────────────

const AMENITY_TILES: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: "no-fee",     label: "No Fee",     icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M15 9H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H9"/><line x1="12" y1="6" x2="12" y2="8"/><line x1="12" y1="16" x2="12" y2="18"/></svg> },
  { key: "laundry",   label: "Laundry",    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="12" cy="13" r="4"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="9" y1="6" x2="9.01" y2="6"/></svg> },
  { key: "gym",       label: "Gym",        icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6.5 6.5h11m-11 11h11M6.5 6.5v11m11-11v11M3 9h3m-3 6h3m15-6h-3m3 6h-3"/></svg> },
  { key: "doorman",   label: "Doorman",    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M3 7v14m18-14v14"/><path d="M9 21V11h6v10"/><path d="M12 3a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M9 7l3-4 3 4"/></svg> },
  { key: "elevator",  label: "Elevator",   icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="2" width="18" height="20" rx="2"/><line x1="12" y1="2" x2="12" y2="22"/><path d="M8 8l-2 2 2 2"/><path d="M16 12l2-2-2-2"/></svg> },
  { key: "pets",      label: "Pets OK",    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="4" cy="8" r="2"/><path d="M12 18c-4 0-7-2-7-6 0-2.5 2-5 5-5s7 2.5 7 5c0 4-3 6-5 6z"/></svg> },
  { key: "outdoor",   label: "Outdoor",    icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 22V12l9-9 9 9v10"/><path d="M9 22V16h6v6"/></svg> },
  { key: "dishwasher",label: "Dishwasher", icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="12" cy="13" r="5"/><line x1="12" y1="8" x2="12" y2="10"/><circle cx="12" cy="13" r="1" fill="currentColor"/></svg> },
];

function FiltersModal({
  placeType, setPlaceType,
  minBeds, setMinBeds,
  minBaths, setMinBaths,
  minPrice, setMinPrice,
  maxPrice, setMaxPrice,
  amenityFilters, toggleAmenity,
  prices,
  total,
  onClearAll,
  onClose,
}: {
  placeType: "any" | "room" | "entire"; setPlaceType: (v: "any" | "room" | "entire") => void;
  minBeds: number | null; setMinBeds: (v: number | null) => void;
  minBaths: number | null; setMinBaths: (v: number | null) => void;
  minPrice: string; setMinPrice: (v: string) => void;
  maxPrice: string; setMaxPrice: (v: string) => void;
  amenityFilters: Set<string>; toggleAmenity: (key: string) => void;
  prices: number[];
  total: number;
  onClearAll: () => void;
  onClose: () => void;
}) {
  const hasFilters = placeType !== "any" || minBeds !== null || minBaths !== null || !!minPrice || !!maxPrice || amenityFilters.size > 0;

  // Price histogram — computed once from prices prop
  const NUM_BUCKETS = 28;
  const validPrices = prices.filter(p => p > 0);
  const absMax = validPrices.length > 0 ? Math.ceil(Math.max(...validPrices) / 500) * 500 : 10000;
  const currentMin = Math.max(0, Math.min(Number(minPrice) || 0, absMax));
  const currentMax = Math.max(0, Math.min(Number(maxPrice) || absMax, absMax));
  const bucketSize = absMax / NUM_BUCKETS;
  const buckets = Array.from({ length: NUM_BUCKETS }, (_, i) => {
    const lo = i * bucketSize, hi = lo + bucketSize;
    return validPrices.filter(p => p >= lo && p < hi).length;
  });
  const maxCount = Math.max(...buckets, 1);
  const minPct = (currentMin / absMax) * 100;
  const maxPct = (currentMax / absMax) * 100;

  // Custom drag slider — stable refs avoid stale-closure lag
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"min" | "max" | null>(null);
  const minValRef = useRef(currentMin);
  const maxValRef = useRef(currentMax);
  minValRef.current = currentMin;
  maxValRef.current = currentMax;

  const handleThumbDown = (thumb: "min" | "max") => (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    draggingRef.current = thumb;

    const getX = (ev: MouseEvent | TouchEvent) =>
      "touches" in ev ? ev.touches[0].clientX : ev.clientX;

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!trackRef.current || !draggingRef.current) return;
      const rect = trackRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (getX(ev) - rect.left) / rect.width));
      const raw = Math.round((pct * absMax) / 50) * 50;
      if (draggingRef.current === "min") {
        const clamped = Math.min(raw, maxValRef.current - 50);
        setMinPrice(clamped > 0 ? String(clamped) : "");
      } else {
        const clamped = Math.max(raw, minValRef.current + 50);
        setMaxPrice(clamped < absMax ? String(clamped) : "");
      }
    };
    const onUp = () => {
      draggingRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
  };

  const pillActive = "border-[var(--accent)] bg-[var(--accent)] text-white";
  const pillInactive = "border-[var(--border)] text-[var(--muted)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)]";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[3px]" onClick={onClose} />
      <div className="relative bg-[var(--card)] rounded-3xl shadow-2xl w-full max-w-[560px] max-h-[90vh] flex flex-col animate-slide-up">

        {/* Header */}
        <div className="flex items-center justify-center px-6 pt-5 pb-4 border-b border-[var(--border)] relative flex-shrink-0">
          <h2 className="font-semibold text-[0.9rem] text-[var(--foreground)]">Filters</h2>
          <button type="button" onClick={onClose}
            className="absolute right-5 w-8 h-8 flex items-center justify-center rounded-full hover:bg-[var(--surface)] transition-colors text-[var(--muted)] hover:text-[var(--foreground)]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 scrollbar-thin">

          {/* Type of place */}
          <div className="px-6 py-6">
            <h3 className="font-semibold text-[0.9rem] text-[var(--foreground)] mb-1">Type of place</h3>
            <p className="text-[12.5px] text-[var(--muted)] mb-4">Search for a room or an entire home</p>
            <div className="flex rounded-xl border border-[var(--border)] overflow-hidden">
              {(["any", "room", "entire"] as const).map((type) => {
                const label = type === "any" ? "Any type" : type === "room" ? "Room" : "Entire home";
                const active = placeType === type;
                return (
                  <button key={type} type="button" onClick={() => setPlaceType(type)}
                    className={`flex-1 py-3 text-sm font-medium transition-all border-r last:border-r-0 border-[var(--border)] ${
                      active ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)]"
                    }`}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[var(--border)]" />

          {/* Price range */}
          <div className="px-6 py-6">
            <h3 className="font-semibold text-[0.9rem] text-[var(--foreground)] mb-1">Price range</h3>
            <p className="text-[12.5px] text-[var(--muted)] mb-5">Per month</p>

            {/* Histogram + slider combined */}
            <div className="relative select-none">
              {/* Bars */}
              <div className="flex items-end gap-px h-24">
                {buckets.map((count, i) => {
                  const lo = i * bucketSize, hi = lo + bucketSize;
                  const inRange = hi > currentMin && lo < currentMax;
                  return (
                    <div key={i} className="flex-1 rounded-t-[2px]"
                      style={{
                        height: `${count > 0 ? Math.max((count / maxCount) * 100, 5) : 0}%`,
                        background: inRange ? "var(--accent)" : "#E3DDD5",
                        transition: "background 0.1s",
                      }} />
                  );
                })}
              </div>

              {/* Track */}
              <div ref={trackRef} className="relative h-1 mx-0 cursor-pointer">
                <div className="absolute inset-0 bg-[var(--border)] rounded-full" />
                <div className="absolute top-0 h-full rounded-full"
                  style={{ left: `${minPct}%`, right: `${100 - maxPct}%`, background: "var(--accent)" }} />

                {/* Min thumb */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-6 h-6 bg-white rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.18)] border border-[#D0C9C0] cursor-grab active:cursor-grabbing"
                  style={{ left: `calc(${minPct}% - 12px)`, zIndex: 3, touchAction: "none" }}
                  onMouseDown={handleThumbDown("min")}
                  onTouchStart={handleThumbDown("min")}
                />
                {/* Max thumb */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-6 h-6 bg-white rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.18)] border border-[#D0C9C0] cursor-grab active:cursor-grabbing"
                  style={{ left: `calc(${maxPct}% - 12px)`, zIndex: 3, touchAction: "none" }}
                  onMouseDown={handleThumbDown("max")}
                  onTouchStart={handleThumbDown("max")}
                />
              </div>
            </div>

            {/* Min / Max text inputs */}
            <div className="flex items-end gap-3 mt-6">
              <div className="flex-1">
                <label className="block text-[11px] text-[var(--muted)] mb-1.5">Minimum</label>
                <div className="flex items-center gap-1 border border-[var(--border)] rounded-2xl px-4 py-3 focus-within:border-[var(--accent)] transition-colors bg-[var(--surface)]">
                  <span className="text-sm text-[var(--muted)]">$</span>
                  <input type="number" placeholder="0" value={minPrice} onChange={(e) => setMinPrice(e.target.value)}
                    className="flex-1 text-sm bg-transparent text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none min-w-0" />
                </div>
              </div>
              <span className="text-[var(--border)] pb-3.5 shrink-0">—</span>
              <div className="flex-1">
                <label className="block text-[11px] text-[var(--muted)] mb-1.5">Maximum</label>
                <div className="flex items-center gap-1 border border-[var(--border)] rounded-2xl px-4 py-3 focus-within:border-[var(--accent)] transition-colors bg-[var(--surface)]">
                  <span className="text-sm text-[var(--muted)]">$</span>
                  <input type="number" placeholder="Any" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}
                    className="flex-1 text-sm bg-transparent text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none min-w-0" />
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-[var(--border)]" />

          {/* Bedrooms */}
          <div className="px-6 py-6">
            <h3 className="font-semibold text-[0.9rem] text-[var(--foreground)] mb-4">Bedrooms</h3>
            <div className="flex gap-2">
              {([null, 0, 1, 2, 3, 4] as (number | null)[]).map((v) => {
                const label = v === null ? "Any" : v === 0 ? "Studio" : v === 4 ? "4+" : `${v}`;
                return (
                  <button key={label} type="button" onClick={() => setMinBeds(v)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${minBeds === v ? pillActive : pillInactive}`}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[var(--border)]" />

          {/* Bathrooms */}
          <div className="px-6 py-6">
            <h3 className="font-semibold text-[0.9rem] text-[var(--foreground)] mb-4">Bathrooms</h3>
            <div className="flex gap-2">
              {([null, 1, 2, 3] as (number | null)[]).map((v) => {
                const label = v === null ? "Any" : v === 3 ? "3+" : `${v}`;
                return (
                  <button key={label} type="button" onClick={() => setMinBaths(v)}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${minBaths === v ? pillActive : pillInactive}`}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-[var(--border)]" />

          {/* Amenities */}
          <div className="px-6 py-6">
            <h3 className="font-semibold text-[0.9rem] text-[var(--foreground)] mb-4">Amenities</h3>
            <div className="grid grid-cols-4 gap-3">
              {AMENITY_TILES.map(({ key, label, icon }) => {
                const active = amenityFilters.has(key);
                return (
                  <button key={key} type="button" onClick={() => toggleAmenity(key)}
                    className={`flex flex-col items-start gap-2.5 p-3.5 rounded-2xl border transition-all text-left ${
                      active ? "border-[var(--accent)] bg-[var(--accent-light)]" : "border-[var(--border)] hover:border-[var(--accent)]/40"
                    }`}>
                    <span className={active ? "text-[var(--accent)]" : "text-[var(--muted)]"}>{icon}</span>
                    <span className={`text-[11.5px] font-medium leading-tight ${active ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border)] flex-shrink-0">
          <button type="button" onClick={onClearAll}
            className={`text-sm font-medium underline underline-offset-2 transition-colors ${
              hasFilters ? "text-[var(--foreground)] hover:text-[var(--muted)]" : "text-[var(--muted-light)] cursor-default"
            }`}>
            Clear all
          </button>
          <button type="button" onClick={onClose}
            className="px-6 py-3 bg-[var(--accent)] text-white text-sm font-semibold rounded-2xl hover:bg-[var(--accent-hover)] transition-colors">
            Show {total.toLocaleString()} listing{total !== 1 ? "s" : ""}
          </button>
        </div>
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
  const [placeType, setPlaceType] = useState<"any" | "room" | "entire">("any");
  const [minBeds, setMinBeds] = useState<number | null>(null); // null=any, 0=studio, 1,2,3,4
  const [minBaths, setMinBaths] = useState<number | null>(null); // null=any, 1, 2
  const [amenityFilters, setAmenityFilters] = useState<Set<string>>(new Set());
  const [showInsight, setShowInsight] = useState(true);
  const [inputFocused, setInputFocused] = useState(false);

  // ── AI Search state ──────────────────────────────────────────────────────────
  const [isAiMode, setIsAiMode] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResults, setAiResults] = useState<Listing[] | null>(null);
  const [aiScrapeTriggered, setAiScrapeTriggered] = useState(false);
  const [aiRunId, setAiRunId] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiScrapeComplete, setAiScrapeComplete] = useState(false);

  useEffect(() => {
    fetch("/api/sources").then((r) => r.json()).then(setSources).catch(console.error);
  }, []);

  useEffect(() => {
    setLoading(true);
    setLimit(50);
  }, [mode, source]);

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
      if (source) params.set("source", source);
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
  }, [mode, source, limit]);

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

  const handleAiSearch = useCallback(async (prompt: string) => {
    if (!prompt.trim()) return;
    setIsAiMode(true);
    setAiLoading(true);
    setAiResults(null);
    setAiScrapeTriggered(false);
    setAiRunId(null);
    setAiScrapeComplete(false);
    setAiSummary(null);
    try {
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data: AiSearchResult = await res.json();
      setAiResults(data.listings ?? []);
      setAiSummary(data.summary ?? null);
      setAiScrapeTriggered(data.scrapeTriggered ?? false);
      setAiRunId(data.runId ?? null);
    } catch (e) {
      console.error(e);
      setAiResults([]);
    } finally {
      setAiLoading(false);
    }
  }, []);

  // Auto-refresh AI results 35 seconds after a scrape is triggered
  useEffect(() => {
    if (!aiScrapeTriggered || aiScrapeComplete || !q.trim()) return;
    const timer = setTimeout(() => {
      setAiScrapeComplete(true);
      handleAiSearch(q);
    }, 35000);
    return () => clearTimeout(timer);
  }, [aiScrapeTriggered, aiScrapeComplete, handleAiSearch, q]);

  // When a map pin is hovered, scroll the corresponding card into view
  useEffect(() => {
    if (!hoveredListingId || hoverSourceRef.current !== "map") return;
    const el = cardRefsMap.current.get(hoveredListingId);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [hoveredListingId]);

  // Apply client-side filters
  const neighborhoodFiltered = listings
    .filter((l) => !hiddenIds.has(l.id))
    .filter((l) => {
      if (placeType === "any") return true;
      const isRoom = l.title?.toLowerCase().includes("room") || l.address?.toLowerCase().includes("room");
      return placeType === "room" ? !!isRoom : !isRoom;
    })
    .filter((l) => {
      if (selectedNeighborhoods.size === 0) return true;
      return [...selectedNeighborhoods].some((nta) =>
        nta.split(/[-–,]/).some((part) =>
          l.neighborhood?.toLowerCase().includes(part.trim().toLowerCase())
        )
      );
    })
    .filter((l) => {
      if (minBeds === null) return true;
      if (minBeds === 0) return l.beds === 0; // studio exactly
      return (l.beds ?? 0) >= minBeds;
    })
    .filter((l) => {
      if (minBaths === null) return true;
      return (l.baths ?? 0) >= minBaths;
    })
    .filter((l) => {
      if (!minPrice && !maxPrice) return true;
      const p = l.price ?? 0;
      if (minPrice && p < Number(minPrice)) return false;
      if (maxPrice && p > Number(maxPrice)) return false;
      return true;
    })
    .filter((l) => {
      if (amenityFilters.size === 0) return true;
      const amen = (l.amenities ?? "").toLowerCase();
      return [...amenityFilters].every((key) => {
        switch (key) {
          case "no-fee":      return amen.includes("no fee") || amen.includes("no broker fee");
          case "laundry":     return amen.includes("laundry") || amen.includes("washer");
          case "gym":         return amen.includes("gym") || amen.includes("fitness");
          case "doorman":     return amen.includes("doorman");
          case "elevator":    return amen.includes("elevator");
          case "pets":        return amen.includes("pet");
          case "outdoor":     return amen.includes("outdoor") || amen.includes("terrace") || amen.includes("balcony") || amen.includes("garden");
          case "dishwasher":  return amen.includes("dishwasher");
          default:            return true;
        }
      });
    });

  const toggleAmenity = useCallback((key: string) => {
    setAmenityFilters((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

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

  const activeListings = isAiMode && aiResults ? aiResults : listings;
  const mapListings = activeListings
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
  if (minBeds !== null) {
    prefChips.push(minBeds === 0 ? "Studio" : `${minBeds}+ bed${minBeds === 1 ? "" : "s"}`);
  }
  if (minBaths !== null) prefChips.push(`${minBaths}+ bath${minBaths === 1 ? "" : "s"}`);
  if (selectedNeighborhoods.size > 0) {
    const areas = [...selectedNeighborhoods].slice(0, 2).join(", ");
    const extra = selectedNeighborhoods.size > 2 ? ` +${selectedNeighborhoods.size - 2}` : "";
    prefChips.push(`Areas: ${areas}${extra}`);
  }

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
        <div className="w-full md:w-1/2 overflow-y-auto flex-shrink-0 scrollbar-hide">
          <div className="pl-14 pr-5 pt-6 pb-8">

            {/* ── AI Hero Search ── */}
            <div className="mb-6">
              <h2 className="font-serif text-[2.1rem] font-semibold text-[var(--foreground)] mb-5 leading-tight tracking-tight">
                Find your next home.
              </h2>

              {/* Search input */}
              <div className={`relative flex items-center bg-[var(--card)] border rounded-2xl transition-all duration-300 ${
                inputFocused
                  ? "border-[var(--accent)]/60 shadow-[0_0_0_4px_rgba(232,113,74,0.08),0_4px_24px_rgba(0,0,0,0.07)]"
                  : "border-[var(--border)] shadow-[0_2px_16px_rgba(0,0,0,0.05)]"
              }`}>
                {/* Left icon */}
                <div className="absolute left-4 pointer-events-none">
                  {aiLoading ? (
                    <svg className="animate-spin text-[var(--accent)]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.25" /><path d="M12 2a10 10 0 0 1 10 10" /></svg>
                  ) : isAiMode ? (
                    <svg className="text-[var(--accent)]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                    </svg>
                  ) : (
                    <svg className="text-[var(--muted-light)]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  )}
                </div>

                <input
                  type="text"
                  placeholder="2BR under $3,500 near Central Park…"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    if (isAiMode) { setIsAiMode(false); setAiResults(null); }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && q.trim()) handleAiSearch(q.trim());
                  }}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  className="w-full pl-11 pr-14 py-4 text-[0.875rem] bg-transparent text-[var(--foreground)] placeholder:text-[var(--muted-light)] focus:outline-none rounded-2xl"
                />

                {/* Right: clear button or ↵ hint */}
                <div className="absolute right-3.5">
                  {q ? (
                    <button
                      type="button"
                      onClick={() => { setQ(""); setIsAiMode(false); setAiResults(null); }}
                      className="text-[var(--muted-light)] hover:text-[var(--muted)] transition-colors p-1 rounded-lg hover:bg-[var(--surface)]"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                  ) : (
                    <span className="text-[10px] text-[var(--muted-light)] border border-[var(--border)] rounded-md px-1.5 py-0.5 font-medium pointer-events-none select-none">↵</span>
                  )}
                </div>
              </div>

              {/* Prompt chips */}
              <div className="flex flex-wrap gap-2 mt-3">
                {PROMPT_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => { setQ(chip); handleAiSearch(chip); }}
                    className="text-[11px] text-[var(--muted)] border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 rounded-full hover:bg-[var(--accent-light)] hover:border-[var(--accent)]/40 hover:text-[var(--accent)] transition-all duration-150"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>


            {/* ── AI searching banner ── */}
            {aiLoading && (
              <div className="flex items-center gap-3 px-4 py-3 mb-4 bg-[var(--accent-light)] border border-[var(--accent)]/20 rounded-xl">
                <svg className="animate-spin shrink-0 text-[var(--accent)]" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                <span className="text-xs font-medium text-[var(--accent)]">Hunter is searching for your perfect apartment…</span>
              </div>
            )}

            {/* ── Scrape in-progress banner ── */}
            {isAiMode && aiScrapeTriggered && !aiScrapeComplete && !aiLoading && (
              <div className="flex items-center gap-3 px-4 py-3 mb-4 bg-[var(--card)] border border-[var(--border)] rounded-xl">
                <span className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />
                <span className="text-xs text-[var(--muted)]">
                  Hunter is finding more listings from StreetEasy — refreshing shortly…
                </span>
              </div>
            )}

            {/* ── AI result header / regular result count ── */}
            <div className="mb-4">
              {isAiMode && aiSummary && !aiLoading ? (
                <div className="mb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--accent)]">Hunter AI</span>
                    {(aiResults?.length ?? 0) > 0 && (
                      <span className="text-[10px] text-[var(--muted-light)]">· {aiResults!.length} match{aiResults!.length !== 1 ? "es" : ""}</span>
                    )}
                  </div>
                  <p className="text-sm text-[var(--foreground)] leading-relaxed">{aiSummary}</p>
                </div>
              ) : !loading && !isAiMode && visibleListings.length > 0 ? (
                <p className="text-sm text-[var(--foreground)] mb-3 leading-relaxed">
                  Found{" "}
                  <strong>{visibleListings.length.toLocaleString()}</strong> apartments{visibleListings.length > 3 ? " — here are the top picks." : "."}
                </p>
              ) : null}
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

                {/* Filters button */}
                {(() => {
                  const fc = [placeType !== "any", minBeds !== null, minBaths !== null, !!minPrice || !!maxPrice, amenityFilters.size > 0].filter(Boolean).length;
                  return (
                    <button
                      type="button"
                      onClick={() => setShowFilters(true)}
                      className={`ml-1 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all border ${
                        fc > 0
                          ? "bg-[var(--foreground)] text-[var(--card)] border-[var(--foreground)]"
                          : "bg-[var(--card)] text-[var(--muted)] border-[var(--border)] hover:border-[var(--foreground)] hover:text-[var(--foreground)]"
                      }`}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/>
                      </svg>
                      Filters{fc > 0 ? ` · ${fc}` : ""}
                    </button>
                  );
                })()}
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
            {aiLoading ? (
              // AI loading skeleton
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="bg-[var(--card)] rounded-2xl border border-[var(--border)] overflow-hidden animate-pulse" style={{ animationDelay: `${i * 80}ms` }}>
                    <div className="bg-[var(--surface)]" style={{ aspectRatio: "16/10" }} />
                    <div className="p-4 space-y-3">
                      <div className="h-4 bg-[var(--surface)] rounded w-3/4" />
                      <div className="h-3 bg-[var(--surface)] rounded w-1/2" />
                      <div className="h-3 bg-[var(--surface)] rounded w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : isAiMode && aiResults !== null ? (
              // AI search results
              aiResults.length === 0 ? (
                <div className="text-center py-20">
                  <p className="font-serif text-2xl text-[var(--muted)] mb-2">No matches found</p>
                  <p className="text-xs text-[var(--muted-light)]">Hunter is searching for more — check back in a moment</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  {aiResults.map((l, i) => (
                    <div key={l.id} ref={(el) => { if (el) cardRefsMap.current.set(l.id, el); else cardRefsMap.current.delete(l.id); }}>
                      <ListingCard
                        listing={l}
                        index={i}
                        compact
                        isAiResult
                        isSaved={savedIds.has(l.id)}
                        onSaveToggle={handleSaveToggle}
                        isHovered={hoveredListingId === l.id}
                        onHoverChange={(h) => { hoverSourceRef.current = "card"; setHoveredListingId(h ? l.id : null); }}
                      />
                    </div>
                  ))}
                </div>
              )
            ) : loading ? (
              // Regular loading skeleton
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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

        {/* RIGHT: map */}
        <div className="hidden md:flex flex-1 pt-6 pl-8 pr-14 pb-8">
          <div className="relative flex-1 rounded-2xl overflow-hidden border border-[var(--border)] shadow-md">
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
      </div>

      {/* ── Filters modal ── */}
      {showFilters && (
        <FiltersModal
          placeType={placeType} setPlaceType={setPlaceType}
          minBeds={minBeds} setMinBeds={setMinBeds}
          minBaths={minBaths} setMinBaths={setMinBaths}
          minPrice={minPrice} setMinPrice={setMinPrice}
          maxPrice={maxPrice} setMaxPrice={setMaxPrice}
          amenityFilters={amenityFilters} toggleAmenity={toggleAmenity}
          prices={listings.map(l => l.price).filter((p): p is number => p !== null)}
          total={visibleListings.length}
          onClearAll={() => { setPlaceType("any"); setMinBeds(null); setMinBaths(null); setMinPrice(""); setMaxPrice(""); setAmenityFilters(new Set()); }}
          onClose={() => setShowFilters(false)}
        />
      )}

      {/* ── Sticky saved tray ── */}
      {savedIds.size > 0 && (
        <SavedTray count={savedIds.size} onClear={() => setSavedIds(new Set())} />
      )}
    </>
  );
}

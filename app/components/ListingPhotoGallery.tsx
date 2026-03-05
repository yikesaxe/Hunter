"use client";

import { useCallback, useEffect, useState } from "react";

export function ListingPhotoGallery({
  photos,
  source,
  address,
}: {
  photos: string[];
  source: string;
  address: string | null;
}) {
  const [modalIdx, setModalIdx] = useState<number | null>(null);
  const [failedSet, setFailedSet] = useState<Set<number>>(new Set());

  const count = photos.length;

  const openModal = (i: number) => setModalIdx(i);
  const closeModal = () => setModalIdx(null);

  const modalPrev = useCallback(
    () => setModalIdx((i) => (i == null ? null : (i - 1 + count) % count)),
    [count]
  );
  const modalNext = useCallback(
    () => setModalIdx((i) => (i == null ? null : (i + 1) % count)),
    [count]
  );

  // Keyboard nav
  useEffect(() => {
    if (modalIdx == null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") modalPrev();
      else if (e.key === "ArrowRight") modalNext();
      else if (e.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [modalIdx, modalPrev, modalNext]);

  // Lock body scroll while modal is open
  useEffect(() => {
    document.body.style.overflow = modalIdx != null ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [modalIdx]);

  // ── Helper: single clickable photo cell ──────────────────────────────────
  function cell(
    idx: number,
    extraCls = "",
    overlayContent?: React.ReactNode
  ) {
    const src = photos[idx];
    if (!src || failedSet.has(idx)) {
      return <div className={`bg-[var(--surface)] ${extraCls}`} />;
    }
    return (
      <div
        className={`relative overflow-hidden cursor-pointer group ${extraCls}`}
        onClick={() => openModal(idx)}
      >
        <img
          src={src}
          alt={`Photo ${idx + 1}`}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          onError={() => setFailedSet((s) => new Set(s).add(idx))}
        />
        {/* Subtle hover darkening */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200 pointer-events-none" />
        {overlayContent}
      </div>
    );
  }

  // ── "Show all N photos" button label ─────────────────────────────────────
  const gridIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );

  // ── Photo grid (centered, max-w-6xl) ─────────────────────────────────────
  function renderGrid() {
    if (count === 0) {
      return (
        <div
          className="w-full rounded-2xl overflow-hidden flex items-end pb-10 pl-10"
          style={{ height: 440, background: "linear-gradient(135deg,#E8E0D5 0%,#C8BAA8 50%,#D4C9B8 100%)" }}
        >
          <span className="font-serif text-9xl font-bold text-white/25 select-none leading-none">
            {(address ?? source ?? "?")[0]}
          </span>
        </div>
      );
    }

    if (count === 1) {
      return (
        <div className="rounded-2xl overflow-hidden" style={{ height: 500 }}>
          {cell(0, "w-full h-full")}
        </div>
      );
    }

    if (count === 2) {
      return (
        <div className="grid grid-cols-2 gap-1.5 rounded-2xl overflow-hidden" style={{ height: 480 }}>
          {cell(0, "h-full")}
          {cell(1, "h-full")}
        </div>
      );
    }

    if (count === 3) {
      return (
        <div
          className="grid gap-1.5 rounded-2xl overflow-hidden"
          style={{ gridTemplateColumns: "3fr 2fr", height: 480 }}
        >
          {cell(0, "h-full")}
          <div className="grid grid-rows-2 gap-1.5 h-full">
            {cell(1, "h-full")}
            {cell(2, "h-full")}
          </div>
        </div>
      );
    }

    if (count === 4) {
      // Large left + 3 stacked right
      return (
        <div
          className="grid gap-1.5 rounded-2xl overflow-hidden relative"
          style={{ gridTemplateColumns: "3fr 2fr", height: 480 }}
        >
          {cell(0, "h-full")}
          <div className="grid grid-rows-3 gap-1.5 h-full">
            {cell(1, "h-full")}
            {cell(2, "h-full")}
            {cell(3, "h-full")}
          </div>
          {/* Show all button */}
          <button
            type="button"
            onClick={() => openModal(0)}
            className="absolute bottom-4 right-4 flex items-center gap-2 bg-white/95 text-[var(--foreground)] text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg hover:bg-white transition-colors border border-[var(--border)]"
          >
            {gridIcon}
            Show all {count} photos
          </button>
        </div>
      );
    }

    // 5+ photos: hero left + 2×2 right
    const showOverlayOnLast = count > 5;
    const overlayNode = showOverlayOnLast ? (
      <div className="absolute inset-0 bg-black/45 hover:bg-black/50 transition-colors flex items-center justify-center pointer-events-none">
        <div className="flex items-center gap-2 bg-white/95 text-[var(--foreground)] text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg">
          {gridIcon}
          Show all {count} photos
        </div>
      </div>
    ) : undefined;

    return (
      <div
        className="grid gap-1.5 rounded-2xl overflow-hidden relative"
        style={{ gridTemplateColumns: "3fr 2fr", height: 480 }}
      >
        {cell(0, "h-full")}
        <div className="grid grid-rows-2 grid-cols-2 gap-1.5 h-full">
          {cell(1, "h-full")}
          {cell(2, "h-full")}
          {cell(3, "h-full")}
          {cell(4, "h-full", overlayNode)}
        </div>
        {/* Show all button (count ≤ 5) */}
        {!showOverlayOnLast && (
          <button
            type="button"
            onClick={() => openModal(0)}
            className="absolute bottom-4 right-4 flex items-center gap-2 bg-white/95 text-[var(--foreground)] text-sm font-semibold px-4 py-2.5 rounded-full shadow-lg hover:bg-white transition-colors border border-[var(--border)]"
          >
            {gridIcon}
            Show all {count} photos
          </button>
        )}
      </div>
    );
  }

  // ── Back arrow + source badge ─────────────────────────────────────────────
  const ChevronLeft = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );

  return (
    <>
      {/* ── Top bar ── */}
      <div className="mx-auto max-w-7xl px-5 sm:px-10 pt-6 pb-3 flex items-center justify-between">
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-[var(--muted)] hover:text-[var(--foreground)] text-sm font-medium transition-colors"
        >
          <ChevronLeft />
          Back
        </a>
        <span className="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest">
          {source}
        </span>
      </div>

      {/* ── Centered photo grid ── */}
      <div className="mx-auto max-w-7xl px-5 sm:px-10">
        {renderGrid()}
      </div>

      {/* ── Fullscreen lightbox modal ── */}
      {modalIdx != null && (
        <div
          className="fixed inset-0 z-[200] flex flex-col"
          style={{ backgroundColor: "rgba(0,0,0,0.95)" }}
          onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
            <span className="text-sm tabular-nums font-medium" style={{ color: "rgba(255,255,255,0.45)" }}>
              {modalIdx + 1} / {count}
            </span>
            <button
              type="button"
              onClick={closeModal}
              className="w-10 h-10 flex items-center justify-center rounded-full text-white transition-colors"
              style={{ backgroundColor: "rgba(255,255,255,0.1)" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.2)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.1)")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* Main photo */}
          <div className="flex-1 relative flex items-center justify-center px-16 pb-3 overflow-hidden">
            {photos[modalIdx] && !failedSet.has(modalIdx) ? (
              <img
                key={modalIdx}
                src={photos[modalIdx]}
                alt={`Photo ${modalIdx + 1}`}
                referrerPolicy="no-referrer"
                className="rounded-xl object-contain"
                style={{
                  maxWidth: "100%",
                  maxHeight: "calc(100vh - 180px)",
                  width: "auto",
                  height: "auto",
                  display: "block",
                  animation: "fadeIn 0.18s ease both",
                }}
                onError={() => setFailedSet((s) => new Set(s).add(modalIdx!))}
              />
            ) : (
              <div className="w-96 h-64 rounded-xl flex items-center justify-center" style={{ backgroundColor: "rgba(255,255,255,0.05)" }}>
                <span className="text-sm" style={{ color: "rgba(255,255,255,0.25)" }}>Image unavailable</span>
              </div>
            )}

            {/* Prev / Next */}
            {count > 1 && (
              <>
                <button
                  type="button"
                  aria-label="Previous photo"
                  onClick={(e) => { e.stopPropagation(); modalPrev(); }}
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full text-white flex items-center justify-center transition-colors"
                  style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.22)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.12)")}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Next photo"
                  onClick={(e) => { e.stopPropagation(); modalNext(); }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full text-white flex items-center justify-center transition-colors"
                  style={{ backgroundColor: "rgba(255,255,255,0.12)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.22)")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.12)")}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </button>
              </>
            )}
          </div>

          {/* Thumbnail strip */}
          {count > 1 && (
            <div className="shrink-0 px-6 pb-6">
              <div className="flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
                {photos.map((src, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setModalIdx(i)}
                    className="flex-none w-[68px] h-[48px] rounded-lg overflow-hidden transition-all duration-150"
                    style={{
                      opacity: i === modalIdx ? 1 : 0.38,
                      outline: i === modalIdx ? "2px solid rgba(255,255,255,0.85)" : "2px solid transparent",
                      outlineOffset: "2px",
                    }}
                  >
                    <img
                      src={src}
                      alt=""
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

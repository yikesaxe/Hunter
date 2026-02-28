"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function ListingPhotoGallery({
  photos,
  source,
  address,
}: {
  photos: string[];
  source: string;
  address: string | null;
}) {
  const [idx, setIdx] = useState(0);
  const [opacity, setOpacity] = useState(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbsRef = useRef<HTMLDivElement>(null);
  const [failedSet, setFailedSet] = useState<Set<number>>(new Set());

  const navigate = useCallback(
    (next: number) => {
      if (next === idx || photos.length <= 1) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      setOpacity(0);
      timerRef.current = setTimeout(() => {
        setIdx(next);
        setOpacity(1);
      }, 180);
    },
    [idx, photos.length]
  );

  const prev = useCallback(() => navigate((idx - 1 + photos.length) % photos.length), [idx, navigate, photos.length]);
  const next = useCallback(() => navigate((idx + 1) % photos.length), [idx, navigate, photos.length]);

  // Keyboard ← → navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [prev, next]);

  // Keep active thumbnail scrolled into view
  useEffect(() => {
    const strip = thumbsRef.current;
    if (!strip) return;
    const thumb = strip.querySelector<HTMLElement>(`[data-thumb="${idx}"]`);
    thumb?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [idx]);

  const currentPhoto = photos[idx] ?? null;
  const isCurrentFailed = failedSet.has(idx);
  const showImage = currentPhoto && !isCurrentFailed;

  return (
    <>
      {/* ── Hero ── */}
      <div
        className="relative w-full bg-[var(--surface)] group overflow-hidden"
        style={{ height: "clamp(280px, 44vw, 560px)" }}
      >
        {showImage ? (
          <img
            key={idx}
            src={currentPhoto}
            alt={address ?? "Listing photo"}
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
            style={{ opacity, transition: "opacity 0.25s ease" }}
            onError={() => setFailedSet((s) => new Set(s).add(idx))}
          />
        ) : (
          <div
            className="w-full h-full flex items-end pb-10 pl-10"
            style={{
              background: "linear-gradient(135deg, #E8E0D5 0%, #C8BAA8 50%, #D4C9B8 100%)",
            }}
          >
            <span className="font-serif text-8xl font-bold text-white/30 select-none leading-none">
              {(address ?? source ?? "?")[0]}
            </span>
          </div>
        )}

        {/* Bottom scrim */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent pointer-events-none" />

        {/* Back button */}
        <div className="absolute top-5 left-5 z-10">
          <a
            href="/"
            className="inline-flex items-center gap-1.5 bg-white/90 backdrop-blur-sm text-[var(--foreground)] text-sm font-medium px-3 py-1.5 rounded-full border border-white/50 hover:bg-white transition-colors shadow-sm"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back
          </a>
        </div>

        {/* Source + photo counter — top right */}
        <div className="absolute top-5 right-5 z-10 flex items-center gap-2">
          {photos.length > 1 && (
            <span className="bg-black/50 backdrop-blur-sm text-white text-[11px] font-medium tabular-nums px-2.5 py-1 rounded-full">
              {idx + 1} / {photos.length}
            </span>
          )}
          <span className="bg-white/90 backdrop-blur-sm text-[var(--muted)] text-[10px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/50 shadow-sm">
            {source}
          </span>
        </div>

        {/* Prev / Next arrows */}
        {photos.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous photo"
              onClick={prev}
              className="absolute left-4 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/85 backdrop-blur-sm shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white hover:scale-105 active:scale-95 transition-all duration-200"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Next photo"
              onClick={next}
              className="absolute right-4 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full bg-white/85 backdrop-blur-sm shadow-lg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white hover:scale-105 active:scale-95 transition-all duration-200"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </>
        )}

        {/* Dot indicators — bottom center, up to 12 photos */}
        {photos.length > 1 && photos.length <= 12 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5">
            {photos.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Photo ${i + 1}`}
                onClick={() => navigate(i)}
                style={{
                  width: i === idx ? "20px" : "7px",
                  height: "7px",
                  borderRadius: "3.5px",
                  background: i === idx ? "white" : "rgba(255,255,255,0.5)",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                  transition: "width 0.2s ease, background 0.2s ease",
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Thumbnail strip ── */}
      {photos.length > 1 && (
        <div className="bg-[var(--foreground)]">
          <div
            ref={thumbsRef}
            className="mx-auto max-w-6xl px-5 sm:px-8 flex gap-2 py-2.5 overflow-x-auto"
            style={{ scrollbarWidth: "none" }}
          >
            {photos.map((src, i) => (
              <button
                key={i}
                type="button"
                data-thumb={i}
                aria-label={`Jump to photo ${i + 1}`}
                onClick={() => navigate(i)}
                className="flex-none focus:outline-none"
                style={{
                  width: "80px",
                  height: "56px",
                  borderRadius: "6px",
                  overflow: "hidden",
                  opacity: i === idx ? 1 : 0.5,
                  outline: i === idx ? "2px solid white" : "2px solid transparent",
                  outlineOffset: "2px",
                  transform: i === idx ? "scale(1.05)" : "scale(1)",
                  transition: "opacity 0.2s, outline-color 0.2s, transform 0.2s",
                }}
                onMouseEnter={(e) => { if (i !== idx) (e.currentTarget as HTMLElement).style.opacity = "0.8"; }}
                onMouseLeave={(e) => { if (i !== idx) (e.currentTarget as HTMLElement).style.opacity = "0.5"; }}
              >
                <img
                  src={src}
                  alt={`Photo ${i + 1}`}
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

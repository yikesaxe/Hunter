"use client";

import { useEffect, useState } from "react";

const PREVIEW_COUNT = 10;

type Props = {
  homeFeatures: string[];
  buildingAmenities: string[];
  cssAmenities?: string[];
};

export function ListingAmenities({ homeFeatures, buildingAmenities, cssAmenities = [] }: Props) {
  const [open, setOpen] = useState(false);

  const hasSections = homeFeatures.length > 0 || buildingAmenities.length > 0;
  const allItems = hasSections
    ? [...homeFeatures, ...buildingAmenities]
    : cssAmenities;

  const preview = allItems.slice(0, PREVIEW_COUNT);
  const total = allItems.length;

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (total === 0) return null;

  const AmenityRow = ({ name, accent = false }: { name: string; accent?: boolean }) => (
    <div className="flex items-center gap-3 text-base text-[var(--foreground)]">
      <span className="w-5 h-5 rounded-full border border-[var(--border)] flex items-center justify-center shrink-0">
        <span className={`w-1.5 h-1.5 rounded-full ${accent ? "bg-[var(--accent)]" : "bg-[var(--muted-light)]"}`} />
      </span>
      <span className="leading-snug">{name}</span>
    </div>
  );

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-10 mb-7">
        {preview.map((name) => (
          <AmenityRow
            key={name}
            name={name}
            accent={homeFeatures.includes(name)}
          />
        ))}
      </div>

      {total > PREVIEW_COUNT && (
        <button
          onClick={() => setOpen(true)}
          className="border border-[var(--foreground)] rounded-xl px-6 py-3 text-base font-semibold hover:bg-[var(--surface)] transition-colors"
        >
          Show all {total} amenities
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-[var(--card)] rounded-2xl w-full max-w-2xl max-h-[82vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-8 pt-6 pb-5 border-b border-[var(--border)] shrink-0">
              <h3 className="font-semibold text-lg text-[var(--foreground)]">What this place offers</h3>
              <button
                onClick={() => setOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--surface)] transition-colors text-[var(--foreground)]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="overflow-y-auto px-8 py-6 scrollbar-thin">
              {homeFeatures.length > 0 && (
                <div className={buildingAmenities.length > 0 ? "mb-8" : ""}>
                  <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-5">In this unit</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-10">
                    {homeFeatures.map((name) => <AmenityRow key={name} name={name} accent />)}
                  </div>
                </div>
              )}

              {buildingAmenities.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-[var(--muted)] uppercase tracking-widest mb-5">Building amenities</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-10">
                    {buildingAmenities.map((name) => <AmenityRow key={name} name={name} />)}
                  </div>
                </div>
              )}

              {!hasSections && cssAmenities.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-10">
                  {cssAmenities.map((name) => <AmenityRow key={name} name={name} />)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

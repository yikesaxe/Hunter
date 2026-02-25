"use client";

import { useMemo } from "react";

// Manhattan neighborhoods (matches Onboarding data)
const MANHATTAN_NEIGHBORHOODS = [
  "Battery Park City",
  "Chelsea",
  "East Village",
  "Financial District",
  "Gramercy",
  "Greenwich Village",
  "Harlem",
  "Hell's Kitchen",
  "Inwood",
  "Lower East Side",
  "Midtown East",
  "Midtown West",
  "Morningside Heights",
  "Murray Hill",
  "SoHo",
  "Tribeca",
  "Upper East Side",
  "Upper West Side",
  "Washington Heights",
  "West Village",
] as const;

// Manhattan island silhouette (simplified long north–south shape)
const MANHATTAN_VIEWBOX = "0 0 120 400";
const MANHATTAN_PATH =
  "M60 6 C 40 6 24 40 24 100 L 24 300 C 24 360 40 394 60 394 C 80 394 96 360 96 300 L 96 100 C 96 40 80 6 60 6 Z";

export type ManhattanNeighborhood = (typeof MANHATTAN_NEIGHBORHOODS)[number];

type Props = {
  selected: string[];
  onChange: (neighborhoods: string[]) => void;
  className?: string;
};

export function ManhattanNeighborhoodSelector({
  selected,
  onChange,
  className = "",
}: Props) {
  const allSelected =
    MANHATTAN_NEIGHBORHOODS.length > 0 &&
    MANHATTAN_NEIGHBORHOODS.every((n) => selected.includes(n));
  const someSelected = selected.length > 0;

  const toggleOne = (name: string) => {
    if (selected.includes(name)) {
      onChange(selected.filter((n) => n !== name));
    } else {
      onChange([...selected, name]);
    }
  };

  const toggleAll = () => {
    if (allSelected) {
      onChange([]);
    } else {
      onChange([...MANHATTAN_NEIGHBORHOODS]);
    }
  };

  const selectionRatio = useMemo(
    () => (MANHATTAN_NEIGHBORHOODS.length ? selected.length / MANHATTAN_NEIGHBORHOODS.length : 0),
    [selected.length]
  );

  return (
    <div
      className={`rounded-2xl overflow-hidden border flex flex-col sm:flex-row min-h-[320px] ${className}`}
      style={{
        borderColor: "var(--border)",
        background: "var(--card)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      {/* ── Map (left) ───────────────────────────────────────────── */}
      <div
        className="relative shrink-0 w-full sm:w-[44%] min-h-[200px] sm:min-h-0 flex items-center justify-center"
        style={{ background: "var(--surface)" }}
      >
        <svg
          viewBox={MANHATTAN_VIEWBOX}
          className="w-full h-full max-h-[280px] sm:max-h-none sm:h-full p-4 sm:p-6"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
        >
          <defs>
            <linearGradient
              id="manhattan-fill"
              x1="0%"
              y1="0%"
              x2="0%"
              y2="100%"
            >
              <stop
                offset="0%"
                stopColor="var(--accent)"
                stopOpacity={0.08 + selectionRatio * 0.32}
              />
              <stop
                offset="100%"
                stopColor="var(--accent)"
                stopOpacity={0.04 + selectionRatio * 0.2}
              />
            </linearGradient>
            <filter id="map-soft">
              <feGaussianBlur in="SourceGraphic" stdDeviation="0.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <path
            d={MANHATTAN_PATH}
            fill="url(#manhattan-fill)"
            stroke="var(--border)"
            strokeWidth="1.2"
            className="transition-[fill-opacity,stroke] duration-300"
            style={{ filter: "url(#map-soft)" }}
          />
        </svg>
        <div
          className="absolute bottom-3 left-3 text-[10px] uppercase tracking-wider font-medium"
          style={{ color: "var(--muted-light)" }}
        >
          Manhattan
        </div>
      </div>

      {/* ── List (right) ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 border-t sm:border-t-0 sm:border-l border-[var(--border)]">
        <div
          className="shrink-0 flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--border)", background: "var(--card)" }}
        >
          <span
            className="text-xs font-semibold uppercase tracking-widest"
            style={{ color: "var(--muted)" }}
          >
            Select neighborhoods
          </span>
          {someSelected && (
            <span
              className="text-xs tabular-nums font-medium"
              style={{ color: "var(--accent)" }}
            >
              {selected.length} selected
            </span>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-3 px-4 py-2.5" style={{ background: "var(--surface)" }}>
          <button
            type="button"
            onClick={toggleAll}
            className="flex items-center gap-2.5 rounded-lg py-2 px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
            style={{
              color: allSelected ? "var(--accent)" : "var(--foreground)",
              background: allSelected ? "var(--accent-light)" : "transparent",
            }}
          >
            <span
              className="w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0"
              style={{
                borderColor: allSelected ? "var(--accent)" : "var(--border)",
                background: allSelected ? "var(--accent)" : "transparent",
              }}
            >
              {allSelected && (
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-white">
                  <path d="M2 5.2L4 7.2L8 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            Manhattan
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-2 max-h-[280px] sm:max-h-none">
          <ul className="space-y-0.5 pb-2">
            {MANHATTAN_NEIGHBORHOODS.map((name) => {
              const isSelected = selected.includes(name);
              return (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => toggleOne(name)}
                    className="w-full flex items-center gap-2.5 rounded-lg py-2.5 px-3 text-left text-sm transition-colors hover:bg-[var(--surface)] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                    style={{
                      color: isSelected ? "var(--foreground)" : "var(--muted)",
                      fontWeight: isSelected ? 500 : 400,
                    }}
                  >
                    <span
                      className="w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors"
                      style={{
                        borderColor: isSelected ? "var(--accent)" : "var(--border)",
                        background: isSelected ? "var(--accent)" : "transparent",
                      }}
                    >
                      {isSelected && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-white">
                          <path d="M2 5.2L4 7.2L8 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    {name}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

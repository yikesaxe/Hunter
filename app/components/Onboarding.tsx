"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ManhattanNeighborhoodSelector } from "./ManhattanNeighborhoodSelector";

// ── Data ────────────────────────────────────────────────────────────────────

const BOROUGHS = {
  Manhattan: [
    "Battery Park City", "Chelsea", "East Village", "Financial District",
    "Gramercy", "Greenwich Village", "Harlem", "Hell's Kitchen", "Inwood",
    "Lower East Side", "Midtown East", "Midtown West", "Morningside Heights",
    "Murray Hill", "SoHo", "Tribeca", "Upper East Side", "Upper West Side",
    "Washington Heights", "West Village",
  ],
  Brooklyn: [
    "Bay Ridge", "Bed-Stuy", "Boerum Hill", "Brooklyn Heights", "Bushwick",
    "Carroll Gardens", "Clinton Hill", "Cobble Hill", "Crown Heights",
    "DUMBO", "Flatbush", "Fort Greene", "Greenpoint", "Park Slope",
    "Prospect Heights", "Red Hook", "Sunset Park", "Williamsburg",
  ],
  Queens: [
    "Astoria", "Elmhurst", "Flushing", "Forest Hills", "Jackson Heights",
    "Kew Gardens", "Long Island City", "Ridgewood", "Sunnyside", "Woodside",
  ],
  Bronx: ["City Island", "Fordham", "Pelham Bay", "Riverdale", "Throggs Neck"],
} as const;

type BoroughKey = keyof typeof BOROUGHS;

const AMENITIES = [
  "Doorman", "Elevator", "In-unit laundry", "Dishwasher",
  "Pet-friendly", "Gym", "Rooftop", "Outdoor space",
  "Parking", "Storage", "No broker fee", "Concierge",
];

const MOVE_IN = [
  { value: "asap", label: "ASAP" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "90", label: "90+ days" },
  { value: "flexible", label: "Flexible" },
];

const BED_OPTIONS = [
  { value: 0, label: "Studio" },
  { value: 1, label: "1 BR" },
  { value: 2, label: "2 BR" },
  { value: 3, label: "3 BR" },
  { value: 4, label: "4+ BR" },
];

const STEPS = ["Welcome", "Budget", "Neighborhoods", "Preferences", "Summary"];

// ── Types ────────────────────────────────────────────────────────────────────

type Prefs = {
  name: string;
  minPrice: number;
  maxPrice: number;
  beds: number[];
  neighborhoods: string[];
  amenities: string[];
  moveIn: string;
  notes: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function toggle<T>(arr: T[], val: T): T[] {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

function formatPrice(v: number) {
  return v >= 10000 ? "$10,000+" : `$${v.toLocaleString()}`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function Chip({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full px-3.5 py-1.5 text-sm border transition-all duration-150 cursor-pointer select-none"
      style={{
        borderColor: selected ? "var(--accent)" : "var(--border)",
        background: selected ? "var(--accent-light)" : "var(--card)",
        color: selected ? "var(--accent)" : "var(--foreground)",
        fontWeight: selected ? 500 : 400,
      }}
    >
      {children}
    </button>
  );
}

function PriceSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-3">
        <label className="text-sm" style={{ color: "var(--muted)" }}>
          {label}
        </label>
        <span className="font-serif text-xl tabular-nums" style={{ color: "var(--foreground)" }}>
          {formatPrice(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer"
        style={{ accentColor: "var(--accent)" }}
      />
      <div className="flex justify-between text-xs mt-1.5" style={{ color: "var(--muted-light)" }}>
        <span>{formatPrice(min)}</span>
        <span>{formatPrice(max)}</span>
      </div>
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <span className="text-sm shrink-0 w-28" style={{ color: "var(--muted)" }}>
        {label}
      </span>
      <span className="text-sm flex-1 font-medium" style={{ color: "var(--foreground)" }}>
        {children}
      </span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "var(--border)" }} />;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const [activeBorough, setActiveBorough] = useState<BoroughKey>("Manhattan");

  const [prefs, setPrefs] = useState<Prefs>({
    name: "",
    minPrice: 2000,
    maxPrice: 5000,
    beds: [],
    neighborhoods: [],
    amenities: [],
    moveIn: "",
    notes: "",
  });

  // Hydrate from API if localStorage is empty (e.g. new device with prefs set elsewhere)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("hunter_prefs")) return;
    fetch("/api/prefs", { credentials: "include" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && data.name) {
          setPrefs({
            name: data.name,
            minPrice: data.minPrice ?? 2000,
            maxPrice: data.maxPrice ?? 5000,
            beds: Array.isArray(data.beds) ? data.beds : [],
            neighborhoods: Array.isArray(data.neighborhoods) ? data.neighborhoods : [],
            amenities: Array.isArray(data.amenities) ? data.amenities : [],
            moveIn: data.moveIn ?? "",
            notes: data.notes ?? "",
          });
          localStorage.setItem("hunter_prefs", JSON.stringify({
            name: data.name,
            minPrice: data.minPrice ?? 2000,
            maxPrice: data.maxPrice ?? 5000,
            beds: data.beds ?? [],
            neighborhoods: data.neighborhoods ?? [],
            amenities: data.amenities ?? [],
            moveIn: data.moveIn ?? "",
            notes: data.notes ?? "",
          }));
        }
      })
      .catch(() => {});
  }, []);

  function goTo(s: number) {
    setStep(s);
    setAnimKey((k) => k + 1);
  }

  const firstName = prefs.name.trim().split(" ")[0] || "";

  const canNext = [
    prefs.name.trim().length > 0 && prefs.beds.length > 0,  // 0: Welcome — name + beds
    true,                             // 1: Budget — no required fields
    prefs.neighborhoods.length > 0,   // 2: Neighborhoods — at least one
    true,                             // 3: Preferences — optional
  ];

  async function handleLaunch() {
    const payload = { ...prefs, moveIn: prefs.moveIn || "" };
    localStorage.setItem("hunter_prefs", JSON.stringify(prefs));
    try {
      await fetch("/api/prefs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (_) {
      // offline or API error; prefs still in localStorage
    }
    router.push("/");
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-[calc(100vh-56px)] flex flex-col">

      {/* ── Step content (scrollable, centered) ─────────────────────────── */}
      <div className="flex-1 flex items-start sm:items-center justify-center px-6 py-10 overflow-y-auto">
        <div className="w-full max-w-lg">

          <div key={animKey} className="animate-fade-up">

            {/* ── Step 0: Welcome ────────────────────────────────────── */}
            {step === 0 && (
              <div>
                <p
                  className="text-xs uppercase tracking-widest mb-4 font-medium"
                  style={{ color: "var(--muted)" }}
                >
                  Let's get started
                </p>
                <h1 className="font-serif text-4xl lg:text-5xl leading-tight mb-4">
                  Find your next<br />home in New York.
                </h1>
                <p className="text-base mb-10" style={{ color: "var(--muted)", lineHeight: 1.75 }}>
                  Tell us what you're looking for and Hunter will continuously scan listings across the city, surfacing the ones that match best.
                </p>
                <div>
                  <label
                    htmlFor="name"
                    className="block text-sm font-medium mb-2"
                    style={{ color: "var(--foreground)" }}
                  >
                    What should we call you?
                  </label>
                  <input
                    id="name"
                    type="text"
                    placeholder="Your name"
                    autoFocus
                    value={prefs.name}
                    onChange={(e) => setPrefs((p) => ({ ...p, name: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && prefs.name.trim() && prefs.beds.length > 0) goTo(1);
                    }}
                    className="w-full rounded-xl px-4 py-3.5 text-base outline-none transition-all"
                    style={{
                      border: "1.5px solid var(--border)",
                      background: "var(--card)",
                      color: "var(--foreground)",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                  />
                </div>
                <div className="mt-8">
                  <p className="text-sm font-medium mb-3" style={{ color: "var(--foreground)" }}>
                    Bedroom preference
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {BED_OPTIONS.map((o) => (
                      <Chip
                        key={o.value}
                        selected={prefs.beds.includes(o.value)}
                        onClick={() =>
                          setPrefs((p) => ({ ...p, beds: toggle(p.beds, o.value) }))
                        }
                      >
                        {o.label}
                      </Chip>
                    ))}
                  </div>
                  {prefs.beds.length === 0 && (
                    <p className="text-xs mt-2" style={{ color: "var(--muted-light)" }}>
                      Select at least one to continue.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* ── Step 1: Budget ─────────────────────────────────────── */}
            {step === 1 && (
              <div>
                <p
                  className="text-xs uppercase tracking-widest mb-4 font-medium"
                  style={{ color: "var(--muted)" }}
                >
                  Budget
                </p>
                <h1 className="font-serif text-4xl lg:text-5xl leading-tight mb-8">
                  What's your budget{firstName ? `, ${firstName}` : ""}?
                </h1>

                <div
                  className="rounded-2xl p-6 mb-8 space-y-7"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                >
                  <PriceSlider
                    label="Minimum"
                    value={prefs.minPrice}
                    min={500}
                    max={9500}
                    step={100}
                    onChange={(v) =>
                      setPrefs((p) => ({ ...p, minPrice: Math.min(v, p.maxPrice - 500) }))
                    }
                  />
                  <Divider />
                  <PriceSlider
                    label="Maximum"
                    value={prefs.maxPrice}
                    min={1000}
                    max={10000}
                    step={100}
                    onChange={(v) =>
                      setPrefs((p) => ({ ...p, maxPrice: Math.max(v, p.minPrice + 500) }))
                    }
                  />
                  <Divider />
                  <div className="flex items-center justify-between">
                    <span className="text-sm" style={{ color: "var(--muted)" }}>
                      Monthly range
                    </span>
                    <span className="font-semibold tabular-nums" style={{ color: "var(--accent)" }}>
                      {formatPrice(prefs.minPrice)} – {formatPrice(prefs.maxPrice)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 2: Neighborhoods (Manhattan) ──────────────────── */}
            {step === 2 && (
              <div>
                <p
                  className="text-xs uppercase tracking-widest mb-4 font-medium"
                  style={{ color: "var(--muted)" }}
                >
                  Location
                </p>
                <h1 className="font-serif text-4xl lg:text-5xl leading-tight mb-2">
                  Where in Manhattan?
                </h1>
                <p className="mb-6 text-sm" style={{ color: "var(--muted)" }}>
                  {prefs.neighborhoods.length === 0
                    ? "Select the neighborhoods you'd consider."
                    : `${prefs.neighborhoods.length} neighborhood${prefs.neighborhoods.length !== 1 ? "s" : ""} selected`}
                </p>

                <ManhattanNeighborhoodSelector
                  selected={prefs.neighborhoods}
                  onChange={(neighborhoods) =>
                    setPrefs((p) => ({ ...p, neighborhoods }))
                  }
                  className="mt-2"
                />

                {prefs.neighborhoods.length === 0 && (
                  <p className="text-xs mt-3" style={{ color: "var(--muted-light)" }}>
                    Select at least one neighborhood to continue.
                  </p>
                )}
              </div>
            )}

            {/* ── Step 3: Preferences ────────────────────────────────── */}
            {step === 3 && (
              <div>
                <p
                  className="text-xs uppercase tracking-widest mb-4 font-medium"
                  style={{ color: "var(--muted)" }}
                >
                  Preferences
                </p>
                <h1 className="font-serif text-4xl lg:text-5xl leading-tight mb-8">
                  What matters most?
                </h1>

                <div className="mb-8">
                  <p className="text-sm font-medium mb-3" style={{ color: "var(--foreground)" }}>
                    Must-haves
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {AMENITIES.map((a) => (
                      <Chip
                        key={a}
                        selected={prefs.amenities.includes(a)}
                        onClick={() =>
                          setPrefs((p) => ({ ...p, amenities: toggle(p.amenities, a) }))
                        }
                      >
                        {a}
                      </Chip>
                    ))}
                  </div>
                </div>

                <div className="mb-8">
                  <p className="text-sm font-medium mb-3" style={{ color: "var(--foreground)" }}>
                    Move-in timeline
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {MOVE_IN.map((o) => (
                      <Chip
                        key={o.value}
                        selected={prefs.moveIn === o.value}
                        onClick={() =>
                          setPrefs((p) => ({
                            ...p,
                            moveIn: p.moveIn === o.value ? "" : o.value,
                          }))
                        }
                      >
                        {o.label}
                      </Chip>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium mb-2" style={{ color: "var(--foreground)" }}>
                    Anything else?{" "}
                    <span style={{ color: "var(--muted)", fontWeight: 400 }}>(optional)</span>
                  </p>
                  <textarea
                    placeholder="e.g. south-facing, below 4th floor, near a park..."
                    value={prefs.notes}
                    onChange={(e) => setPrefs((p) => ({ ...p, notes: e.target.value }))}
                    rows={3}
                    className="w-full rounded-xl px-4 py-3 text-sm resize-none outline-none transition-all"
                    style={{
                      border: "1.5px solid var(--border)",
                      background: "var(--card)",
                      color: "var(--foreground)",
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = "var(--accent)")}
                    onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                  />
                </div>
              </div>
            )}

            {/* ── Step 4: Summary ────────────────────────────────────── */}
            {step === 4 && (
              <div>
                <p
                  className="text-xs uppercase tracking-widest mb-4 font-medium"
                  style={{ color: "var(--accent)" }}
                >
                  Ready
                </p>
                <h1 className="font-serif text-4xl lg:text-5xl leading-tight mb-3">
                  You're all set{firstName ? `, ${firstName}` : ""}!
                </h1>
                <p className="mb-8 text-base" style={{ color: "var(--muted)", lineHeight: 1.75 }}>
                  Hunter will scan listings and surface the best matches based on your preferences.
                </p>

                <div
                  className="rounded-2xl p-6 mb-8 space-y-4"
                  style={{ background: "var(--card)", border: "1px solid var(--border)" }}
                >
                  <SummaryRow label="Budget">
                    {formatPrice(prefs.minPrice)} – {formatPrice(prefs.maxPrice)}/mo
                  </SummaryRow>
                  <Divider />
                  <SummaryRow label="Bedrooms">
                    {prefs.beds.length > 0
                      ? [...prefs.beds]
                          .sort((a, b) => a - b)
                          .map((b) => BED_OPTIONS.find((o) => o.value === b)?.label)
                          .join(", ")
                      : "Any"}
                  </SummaryRow>
                  <Divider />
                  <SummaryRow label="Neighborhoods">
                    {prefs.neighborhoods.length > 0
                      ? `${prefs.neighborhoods.length} neighborhood${prefs.neighborhoods.length !== 1 ? "s" : ""}`
                      : "Any"}
                  </SummaryRow>
                  {prefs.amenities.length > 0 && (
                    <>
                      <Divider />
                      <SummaryRow label="Must-haves">{prefs.amenities.join(", ")}</SummaryRow>
                    </>
                  )}
                  {prefs.moveIn && (
                    <>
                      <Divider />
                      <SummaryRow label="Move-in">
                        {MOVE_IN.find((o) => o.value === prefs.moveIn)?.label ?? prefs.moveIn}
                      </SummaryRow>
                    </>
                  )}
                  {prefs.notes.trim() && (
                    <>
                      <Divider />
                      <SummaryRow label="Notes">{prefs.notes}</SummaryRow>
                    </>
                  )}
                </div>
              </div>
            )}

          </div>

          {/* ── Navigation ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between mt-10">
            <button
              type="button"
              onClick={() => goTo(step - 1)}
              className="px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
              style={{
                visibility: step === 0 ? "hidden" : "visible",
                color: "var(--muted)",
                background: "transparent",
                border: "1px solid var(--border)",
              }}
            >
              ← Back
            </button>

            {step < STEPS.length - 1 ? (
              <button
                type="button"
                onClick={() => goTo(step + 1)}
                disabled={!canNext[step]}
                className="px-7 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200"
                style={{
                  background: canNext[step] ? "var(--accent)" : "var(--surface)",
                  color: canNext[step] ? "white" : "var(--muted-light)",
                  cursor: canNext[step] ? "pointer" : "not-allowed",
                }}
              >
                Continue →
              </button>
            ) : (
              <button
                type="button"
                onClick={handleLaunch}
                className="px-7 py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 active:scale-95 transition-all duration-150"
                style={{ background: "var(--accent)", color: "white" }}
              >
                Start Hunting →
              </button>
            )}
          </div>

        </div>
      </div>

      {/* ── Step bar ────────────────────────────────────────────────────── */}
      <div
        className="shrink-0 px-6 py-5"
        style={{ borderTop: "1px solid var(--border)", background: "var(--card)" }}
      >
        <div className="max-w-lg mx-auto">
          {/* Dots + connecting lines */}
          <div className="flex items-center mb-2.5">
            {STEPS.map((s, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <div key={s} className="flex items-center flex-1 last:flex-none">
                  {/* Dot */}
                  <div
                    className="shrink-0 transition-all duration-300"
                    style={{
                      width: active ? 10 : 8,
                      height: active ? 10 : 8,
                      borderRadius: "50%",
                      background: done || active ? "var(--accent)" : "var(--border)",
                      boxShadow: active ? "0 0 0 3px var(--accent-light)" : "none",
                    }}
                  />
                  {/* Line to next */}
                  {i < STEPS.length - 1 && (
                    <div
                      className="flex-1 mx-1 transition-all duration-300"
                      style={{
                        height: 1,
                        background: done ? "var(--accent)" : "var(--border)",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>

          {/* Step labels */}
          <div className="flex">
            {STEPS.map((s, i) => {
              const done = i < step;
              const active = i === step;
              return (
                <div
                  key={s}
                  className="flex-1 last:flex-none text-xs transition-colors duration-200"
                  style={{
                    color: active
                      ? "var(--foreground)"
                      : done
                      ? "var(--muted)"
                      : "var(--muted-light)",
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {s}
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
}

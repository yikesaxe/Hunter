import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { TrackOutbound } from "@/app/components/TrackOutbound";
import { ListingPhotoGallery } from "@/app/components/ListingPhotoGallery";
import { ListingDescription } from "@/app/components/ListingDescription";
import { ListingAmenities } from "@/app/components/ListingAmenities";
import { ListingLocationMap } from "@/app/components/ListingLocationMap";

// ── NYC Subway line colors (official MTA palette) ──────────────────────────
const SUBWAY_COLORS: Record<string, { bg: string; text: string }> = {
  "1": { bg: "#EE352E", text: "#fff" },
  "2": { bg: "#EE352E", text: "#fff" },
  "3": { bg: "#EE352E", text: "#fff" },
  "4": { bg: "#00933C", text: "#fff" },
  "5": { bg: "#00933C", text: "#fff" },
  "6": { bg: "#00933C", text: "#fff" },
  "6X": { bg: "#00933C", text: "#fff" },
  "7": { bg: "#B933AD", text: "#fff" },
  "7X": { bg: "#B933AD", text: "#fff" },
  "A": { bg: "#0039A6", text: "#fff" },
  "C": { bg: "#0039A6", text: "#fff" },
  "E": { bg: "#0039A6", text: "#fff" },
  "B": { bg: "#FF6319", text: "#fff" },
  "D": { bg: "#FF6319", text: "#fff" },
  "F": { bg: "#FF6319", text: "#fff" },
  "M": { bg: "#FF6319", text: "#fff" },
  "G": { bg: "#6CBE45", text: "#fff" },
  "J": { bg: "#996633", text: "#fff" },
  "Z": { bg: "#996633", text: "#fff" },
  "L": { bg: "#A7A9AC", text: "#fff" },
  "N": { bg: "#FCCC0A", text: "#000" },
  "Q": { bg: "#FCCC0A", text: "#000" },
  "R": { bg: "#FCCC0A", text: "#000" },
  "W": { bg: "#FCCC0A", text: "#000" },
  "S": { bg: "#808183", text: "#fff" },
  "SIR": { bg: "#0039A6", text: "#fff" },
};

function SubwayLine({ line }: { line: string }) {
  const l = line.trim().toUpperCase();
  const color = SUBWAY_COLORS[l] ?? { bg: "#808183", text: "#fff" };
  return (
    <span
      style={{ background: color.bg, color: color.text }}
      className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-full text-[11px] font-bold leading-none shrink-0 shadow-sm"
    >
      {l}
    </span>
  );
}

function parseLines(lines: unknown): string[] {
  if (Array.isArray(lines)) return (lines as unknown[]).map(String).flatMap((s) => s.split(/[,/]+/).map((x) => x.trim())).filter(Boolean);
  if (typeof lines === "string") return lines.split(/[,/]+/).map((s) => s.trim()).filter(Boolean);
  return [];
}

// ── Types for scrapedExtras fields ────────────────────────────────────────
type TransitStop = {
  name?: string;
  station?: string;
  lines?: unknown;
  distance?: string;
  walkMinutes?: number;
};
type School = {
  name: string;
  type?: string;
  grades?: string;
  distance?: string;
};
type MonthlyFee = { name: string; amount: string | number; required?: boolean };
type Fees = {
  applicationFee?: number | null;
  securityDeposit?: number | null;
  brokerFee?: number | null;
  noFee?: boolean;
  monthlyFees?: MonthlyFee[];
};
type Policies = {
  pets?: string | null;
  smoking?: string | null;
  guarantors?: string | null;
  noFee?: boolean;
};
type PriceComparison = {
  medianRent?: number;
  medianStudioRent?: number;
  percentAboveMedian?: number | null;
  percentageAboveMedian?: number | null;
  percentageCheaper?: number | null;
  area?: string;
};
type BrokerExtras = {
  name?: string;
  company?: string;
  email?: string;
  phone?: string;
};

// ── Section heading ────────────────────────────────────────────────────────
function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[1.375rem] font-semibold text-[var(--foreground)] mb-6">
      {children}
    </h2>
  );
}

// ── Sidebar card ───────────────────────────────────────────────────────────
function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5">
      <h3 className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-3">{title}</h3>
      {children}
    </div>
  );
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const listing = await prisma.normalizedListing.findUnique({
    where: { id },
    include: {
      analysis: true,
      canonicalUnit: {
        include: {
          postings: {
            where: { id: { not: id }, status: "active" },
            select: { id: true, source: true, sourceUrl: true, rentGross: true },
            orderBy: { rentGross: "asc" },
          },
        },
      },
    },
  });
  if (!listing) notFound();

  const siblingPostings = listing.canonicalUnit?.postings ?? [];
  const analysis = listing.analysis;
  const redFlags: string[] = Array.isArray(analysis?.redFlags) ? (analysis!.redFlags as string[]) : [];
  const brokerSpeak: { phrase: string; translation: string }[] = Array.isArray(analysis?.brokerSpeak)
    ? (analysis!.brokerSpeak as { phrase: string; translation: string }[])
    : [];
  const photoFlags: string[] = Array.isArray(analysis?.photoFlags) ? (analysis!.photoFlags as string[]) : [];
  const photoScore: number | null = analysis?.overallPhotoScore ?? null;

  const photos: string[] = (() => {
    try { return JSON.parse(listing.photos); } catch { return []; }
  })();
  const cssAmenities: string[] = (() => {
    try {
      const parsed = JSON.parse(listing.amenities);
      if (!Array.isArray(parsed)) return [];
      return parsed.map((a) =>
        typeof a === "string" ? a : (a as Record<string, unknown>)?.name?.toString() ?? ""
      ).filter(Boolean);
    } catch { return []; }
  })();

  // ── Parse scrapedExtras ─────────────────────────────────────────────────
  const extras =
    listing.scrapedExtras && typeof listing.scrapedExtras === "object" && !Array.isArray(listing.scrapedExtras)
      ? (listing.scrapedExtras as Record<string, unknown>)
      : {};

  const toStringArr = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return [];
    return arr.map((item) =>
      typeof item === "string" ? item : (item as Record<string, unknown>)?.name?.toString() ?? ""
    ).filter(Boolean);
  };
  const homeFeatures: string[] = toStringArr(extras.homeFeatures);
  const buildingAmenities: string[] = toStringArr(extras.buildingAmenities);
  const transit: TransitStop[] = Array.isArray(extras.transit) ? (extras.transit as TransitStop[]) : [];
  const schools: School[] = Array.isArray(extras.schools) ? (extras.schools as School[]) : [];
  const fees = extras.fees as Fees | undefined;
  const policies = extras.policies as Policies | undefined;
  const priceComparison = extras.priceComparison as PriceComparison | undefined;
  const brokerExtras = extras.broker as BrokerExtras | undefined;
  const concessions = extras.concessions as Record<string, unknown> | undefined;

  const isNoFee = fees?.noFee === true || policies?.noFee === true || extras.noFee === true || extras.brokerFee === 0;
  const availableText = (extras.availability as string | undefined) ?? (extras.moveInDate as string | undefined) ?? null;

  // Broker — merge DB fields with extras
  const contactName = listing.brokerName ?? brokerExtras?.name ?? null;
  const listedByRaw = extras.listedBy;
  const listedByStr =
    typeof listedByRaw === "string"
      ? listedByRaw
      : listedByRaw != null && typeof listedByRaw === "object"
      ? ((listedByRaw as Record<string, unknown>).name as string | undefined) ?? null
      : null;
  const contactCompany = listedByStr ?? brokerExtras?.company ?? null;
  const contactEmail = listing.brokerEmail ?? brokerExtras?.email ?? null;
  const contactPhone = listing.brokerPhone ?? brokerExtras?.phone ?? null;

  const specs = [
    listing.beds != null && {
      value: listing.beds === 0 ? "Studio" : String(listing.beds),
      label: listing.beds === 1 ? "bed" : "beds",
    },
    listing.baths != null && { value: String(listing.baths), label: listing.baths === 1 ? "bath" : "baths" },
    listing.sqft != null && { value: listing.sqft.toLocaleString(), label: "sqft" },
  ].filter(Boolean) as { value: string; label: string }[];

  const scrapedDate = new Date(listing.lastScrapedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  // ── Concessions to show (skip boring boolean fields) ───────────────────
  const concessionsDisplay = concessions
    ? Object.entries(concessions).filter(([, v]) => v !== null && typeof v !== "boolean" && v !== 0)
    : [];

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* ── Photo gallery ── */}
      <ListingPhotoGallery photos={photos} source={listing.source} address={listing.address} />

      {/* ── Main content ── */}
      <div className="mx-auto max-w-7xl px-5 sm:px-10 py-10 animate-fade-in">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-12 xl:gap-16">

          {/* ═══ LEFT — primary content ═══════════════════════════════════════ */}
          <div>
            {/* ── Price / address / specs — Zillow-style row ── */}
            <div className="flex items-start justify-between gap-8 pb-7 mb-8 border-b border-[var(--border)]">
              {/* LEFT: price + address + pills */}
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-3 mb-1.5">
                  {listing.rentGross != null && (
                    <p className="font-serif text-5xl font-bold text-[var(--accent)] leading-none">
                      ${listing.rentGross.toLocaleString()}
                      <span className="text-xl font-sans font-normal text-[var(--muted-light)] ml-2">/mo</span>
                    </p>
                  )}
                  {isNoFee && (
                    <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                      No Fee
                    </span>
                  )}
                </div>
                {listing.address && (
                  <p className="text-[var(--muted)] text-base mt-1 mb-3">
                    {listing.address}{listing.zip && `, ${listing.zip}`}
                  </p>
                )}
                {(listing.neighborhood || listing.borough) && (
                  <div className="flex flex-wrap gap-2">
                    {listing.neighborhood && (
                      <span className="text-sm bg-[var(--accent-light)] text-[var(--accent)] font-medium px-3 py-1 rounded-full">
                        {listing.neighborhood}
                      </span>
                    )}
                    {listing.borough && listing.borough !== listing.neighborhood && (
                      <span className="text-sm bg-[var(--surface)] text-[var(--muted)] px-3 py-1 rounded-full">
                        {listing.borough}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* RIGHT: beds / baths / sqft */}
              {specs.length > 0 && (
                <div className="flex items-start gap-8 shrink-0 pt-1">
                  {specs.map((s) => (
                    <div key={s.label} className="text-center">
                      <p className="font-serif text-3xl font-bold text-[var(--foreground)] leading-none">{s.value}</p>
                      <p className="text-xs text-[var(--muted)] uppercase tracking-wider mt-1.5">{s.label}</p>
                    </div>
                  ))}
                  {availableText && (
                    <div className="text-center">
                      <p className="font-serif text-3xl font-bold text-[var(--foreground)] leading-none capitalize">
                        {availableText.toLowerCase().startsWith("available") ? availableText.replace(/^available\s*/i, "") || "Now" : availableText}
                      </p>
                      <p className="text-xs text-[var(--muted)] uppercase tracking-wider mt-1.5">available</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── At a glance chips ── */}
            {(isNoFee || availableText || policies?.pets || policies?.smoking || policies?.guarantors || concessionsDisplay.length > 0) && (
              <div className="flex flex-wrap gap-2.5 mb-10">
                {isNoFee && (
                  <span className="inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 text-sm font-medium px-3.5 py-2 rounded-xl">
                    ✓ No broker fee
                  </span>
                )}
                {availableText && (
                  <span className="inline-flex items-center bg-[var(--surface)] text-sm px-3.5 py-2 rounded-xl">
                    <span className="text-[var(--muted)]">Available</span>
                    <span className="font-medium text-[var(--foreground)] capitalize ml-1.5">{availableText.replace(/^available\s*/i, "") || "Now"}</span>
                  </span>
                )}
                {policies?.pets && (
                  <span className="inline-flex items-center bg-[var(--surface)] text-sm px-3.5 py-2 rounded-xl">
                    <span className="text-[var(--muted)]">Pets</span>
                    <span className="font-medium text-[var(--foreground)] capitalize ml-1.5">{policies.pets}</span>
                  </span>
                )}
                {policies?.smoking && (
                  <span className="inline-flex items-center bg-[var(--surface)] text-sm px-3.5 py-2 rounded-xl">
                    <span className="text-[var(--muted)]">Smoking</span>
                    <span className="font-medium text-[var(--foreground)] capitalize ml-1.5">{policies.smoking}</span>
                  </span>
                )}
                {policies?.guarantors && (
                  <span className="inline-flex items-center bg-[var(--surface)] text-sm px-3.5 py-2 rounded-xl">
                    <span className="text-[var(--muted)]">Guarantors</span>
                    <span className="font-medium text-[var(--foreground)] capitalize ml-1.5">{policies.guarantors}</span>
                  </span>
                )}
                {concessionsDisplay.map(([k, v]) => (
                  <span key={k} className="inline-flex items-center bg-[var(--surface)] text-sm px-3.5 py-2 rounded-xl">
                    <span className="text-[var(--muted)] capitalize">{k.replace(/([A-Z])/g, " $1").toLowerCase().trim()}</span>
                    <span className="font-medium text-[var(--foreground)] ml-1.5">{String(v)}</span>
                  </span>
                ))}
              </div>
            )}

            {/* ── Sections — divide-y ensures borders only appear between present sections ── */}
            <div className="divide-y divide-[var(--border)]">

              {listing.description && (
                <section className="py-10">
                  <SectionHeading>About this listing</SectionHeading>
                  <ListingDescription text={listing.description} />
                </section>
              )}

              {(homeFeatures.length > 0 || buildingAmenities.length > 0 || cssAmenities.length > 0) && (
                <section className="py-10">
                  <SectionHeading>What this place offers</SectionHeading>
                  <ListingAmenities
                    homeFeatures={homeFeatures}
                    buildingAmenities={buildingAmenities}
                    cssAmenities={cssAmenities}
                  />
                </section>
              )}

              {transit.length > 0 && (
                <section className="py-10">
                  <SectionHeading>Getting around</SectionHeading>
                  <div>
                    {transit.map((t, i) => {
                      const stationName = t.name ?? t.station ?? "";
                      const lines = parseLines(t.lines);
                      return (
                        <div key={i} className="flex items-center gap-3 py-3 border-b border-[var(--border)] last:border-0">
                          <div className="flex gap-1 shrink-0 w-[88px]">
                            {lines.map((l) => <SubwayLine key={l} line={l} />)}
                          </div>
                          <span className="text-[0.9375rem] text-[var(--foreground)] flex-1 leading-snug">{stationName}</span>
                          <div className="flex items-center gap-2.5 shrink-0">
                            {t.distance && <span className="text-xs text-[var(--muted)]">{t.distance}</span>}
                            {t.walkMinutes != null && (
                              <span className="text-xs text-[var(--muted)] bg-[var(--surface)] px-2 py-0.5 rounded-full whitespace-nowrap">
                                {t.walkMinutes} min
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {schools.length > 0 && (
                <section className="py-10">
                  <SectionHeading>Nearby schools</SectionHeading>
                  <div>
                    {schools.map((s, i) => {
                      const name = s.name.length > 4 && s.name === s.name.toUpperCase()
                        ? s.name.charAt(0) + s.name.slice(1).toLowerCase()
                        : s.name;
                      return (
                        <div key={i} className="flex items-start justify-between gap-4 py-3.5 border-b border-[var(--border)] last:border-0">
                          <div className="flex-1 min-w-0">
                            <p className="text-[0.9375rem] font-medium text-[var(--foreground)] leading-snug">{name}</p>
                            <p className="text-xs text-[var(--muted)] mt-0.5">
                              {[s.type, s.grades && `Grades ${s.grades}`].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                          {s.distance && (
                            <span className="text-xs text-[var(--muted)] bg-[var(--surface)] px-2 py-0.5 rounded-full shrink-0 mt-0.5">
                              {s.distance}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}

              {fees && (fees.applicationFee || fees.securityDeposit || (fees.monthlyFees && fees.monthlyFees.length > 0)) && (
                <section className="py-10">
                  <SectionHeading>Fee breakdown</SectionHeading>
                  <div className="rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--card)]">
                    {(fees.applicationFee || fees.securityDeposit || (fees.brokerFee != null && fees.brokerFee > 0)) && (
                      <div className="px-5 py-4 border-b border-[var(--border)]">
                        <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-3">One-time</p>
                        <div className="space-y-2.5">
                          {fees.applicationFee != null && fees.applicationFee > 0 && (
                            <div className="flex justify-between text-[0.9375rem]">
                              <span className="text-[var(--muted)]">Application fee</span>
                              <span className="font-medium text-[var(--foreground)]">${fees.applicationFee}</span>
                            </div>
                          )}
                          {fees.securityDeposit != null && fees.securityDeposit > 0 && (
                            <div className="flex justify-between text-[0.9375rem]">
                              <span className="text-[var(--muted)]">Security deposit</span>
                              <span className="font-medium text-[var(--foreground)]">
                                ${fees.securityDeposit.toLocaleString()}
                                <span className="text-xs text-[var(--muted-light)] font-normal ml-1">refundable</span>
                              </span>
                            </div>
                          )}
                          {fees.brokerFee != null && fees.brokerFee > 0 && (
                            <div className="flex justify-between text-[0.9375rem]">
                              <span className="text-[var(--muted)]">Broker fee</span>
                              <span className="font-medium text-[var(--foreground)]">${fees.brokerFee.toLocaleString()}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    {fees.monthlyFees && fees.monthlyFees.length > 0 && (
                      <div className="px-5 py-4">
                        <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-3">Optional monthly</p>
                        <div className="space-y-2.5">
                          {fees.monthlyFees.map((f) => (
                            <div key={f.name} className="flex justify-between text-sm">
                              <span className="text-[var(--muted)]">{f.name}</span>
                              <span className="text-[var(--foreground)]">
                                {typeof f.amount === "number" ? `$${f.amount}/mo` : f.amount}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              )}

            </div>
          </div>

          {/* ═══ RIGHT — sidebar ══════════════════════════════════════════════ */}
          <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">

            {/* CTA card */}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-6 shadow-[0_4px_32px_rgba(0,0,0,0.07)]">
              {listing.rentGross != null && (
                <div className="flex items-baseline gap-2 mb-5">
                  <span className="font-serif text-4xl font-bold text-[var(--foreground)]">
                    ${listing.rentGross.toLocaleString()}
                  </span>
                  <span className="text-[var(--muted)] text-base">/month</span>
                </div>
              )}
              {listing.address && (
                <p className="text-sm text-[var(--muted)] mb-5 leading-snug">{listing.address}</p>
              )}
              <TrackOutbound
                listingId={listing.id}
                href={listing.sourceUrl}
                className="w-full flex items-center justify-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-base font-semibold px-4 py-4 rounded-xl transition-colors"
              >
                View on {listing.source}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </TrackOutbound>
              <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center justify-between gap-3">
                <span className="text-xs text-[var(--muted)]">Last seen {scrapedDate}</span>
                {listing.status && (
                  <span className={`inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full capitalize ${
                    listing.status === "active"
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                      : "bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]"
                  }`}>
                    {listing.status}
                  </span>
                )}
              </div>
            </div>

            {/* Price comparison */}
            {priceComparison && (priceComparison.medianRent ?? priceComparison.medianStudioRent) && (
              <SideCard title="Price comparison">
                {(() => {
                  const median = priceComparison.medianRent ?? priceComparison.medianStudioRent ?? 0;
                  const pctAbove = priceComparison.percentAboveMedian ?? priceComparison.percentageAboveMedian;
                  const pctCheaper = priceComparison.percentageCheaper;
                  const isAbove = pctAbove != null && pctAbove > 0;
                  const isBelow = pctCheaper != null && pctCheaper > 0;
                  return (
                    <div>
                      <p className="text-xs text-[var(--muted)] mb-1">
                        {listing.beds === 0 ? "Studio" : `${listing.beds ?? "?"}BR"}`} median in {listing.neighborhood?.split(",")[0] ?? listing.borough ?? "area"}
                      </p>
                      <p className="font-serif text-2xl font-semibold text-[var(--foreground)]">
                        ${median.toLocaleString()}
                        <span className="text-sm font-sans font-normal text-[var(--muted-light)] ml-1">/mo</span>
                      </p>
                      {(isAbove || isBelow) && (
                        <div className={`mt-2 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                          isAbove ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
                        }`}>
                          {isAbove ? `↑ ${pctAbove}% above median` : `↓ ${pctCheaper}% below median`}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </SideCard>
            )}

            {/* Hunter's Take (shown if analysis exists) */}
            {analysis && (analysis.summary || redFlags.length > 0 || brokerSpeak.length > 0 || photoFlags.length > 0) && (
              <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">🔍</span>
                  <h3 className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-widest">Hunter&apos;s Take</h3>
                  {analysis.priceTier && (
                    <span className={`ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      analysis.priceTier === "below_market" ? "bg-emerald-100 text-emerald-700"
                        : analysis.priceTier === "above_market" ? "bg-rose-100 text-rose-700"
                        : "bg-[var(--surface)] text-[var(--muted)]"
                    }`}>
                      {analysis.priceTier === "below_market" ? "Below market"
                        : analysis.priceTier === "above_market" ? "Above market"
                        : "At market"}
                    </span>
                  )}
                </div>
                {analysis.summary && (
                  <p className="text-[0.9375rem] text-[var(--foreground)] leading-relaxed mb-4 italic">
                    &ldquo;{analysis.summary}&rdquo;
                  </p>
                )}
                {redFlags.length > 0 && (
                  <div className="mb-3">
                    <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">Red flags</p>
                    <ul className="space-y-1">
                      {redFlags.map((flag) => (
                        <li key={flag} className="flex items-start gap-1.5 text-xs text-rose-700">
                          <span className="mt-0.5">⚠</span>
                          <span>{flag}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {brokerSpeak.length > 0 && (
                  <div className={photoFlags.length > 0 ? "mb-3" : ""}>
                    <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">Broker speak decoded</p>
                    <ul className="space-y-2">
                      {brokerSpeak.map((bs) => (
                        <li key={bs.phrase} className="text-xs">
                          <span className="font-medium text-[var(--foreground)]">&ldquo;{bs.phrase}&rdquo;</span>
                          <span className="text-[var(--muted)]"> → {bs.translation}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {photoFlags.length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider mb-1.5">Photo analysis</p>
                    <ul className="space-y-1">
                      {photoFlags.map((flag) => (
                        <li key={flag} className="flex items-start gap-1.5 text-xs text-amber-700">
                          <span className="mt-0.5">📷</span>
                          <span>{flag}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Contact */}
            {(contactName || contactCompany || contactEmail || contactPhone) && (
              <SideCard title="Contact">
                {contactName && (
                  <p className="font-medium text-[var(--foreground)] text-sm leading-snug">{contactName}</p>
                )}
                {contactCompany && contactCompany !== contactName && (
                  <p className="text-xs text-[var(--muted)] mt-0.5 mb-2 leading-snug">{contactCompany}</p>
                )}
                {contactPhone && (
                  <a href={`tel:${contactPhone}`} className="block text-sm text-[var(--accent)] hover:underline mt-2">
                    {contactPhone}
                  </a>
                )}
                {contactEmail && (
                  <a href={`mailto:${contactEmail}`} className="block text-sm text-[var(--accent)] hover:underline mt-1 break-all">
                    {contactEmail}
                  </a>
                )}
              </SideCard>
            )}

            {/* Also listed on */}
            {siblingPostings.length > 0 && (
              <SideCard title="Also listed on">
                <ul className="space-y-2">
                  {siblingPostings.map((sibling) => (
                    <li key={sibling.id}>
                      <a href={`/listings/${sibling.id}`} className="flex items-center justify-between text-sm hover:text-[var(--accent)] transition-colors">
                        <span className="font-medium capitalize">{sibling.source}</span>
                        {sibling.rentGross != null && (
                          <span className="text-[var(--muted)]">${sibling.rentGross.toLocaleString()}/mo</span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </SideCard>
            )}

          </div>

        </div>

        {/* ── Location map — full width, below both columns ── */}
        {listing.latitude != null && listing.longitude != null && (
          <>
            <hr className="border-[var(--border)] my-10" />
            <ListingLocationMap
              latitude={listing.latitude}
              longitude={listing.longitude}
              address={listing.address}
              neighborhood={listing.neighborhood}
            />
          </>
        )}
      </div>
    </div>
  );
}

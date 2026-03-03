import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { TrackOutbound } from "@/app/components/TrackOutbound";
import { ListingPhotoGallery } from "@/app/components/ListingPhotoGallery";

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
    <h2 className="font-serif text-xl font-semibold text-[var(--foreground)] mb-4 flex items-center gap-3">
      {children}
      <span className="flex-1 h-px bg-[var(--border)]" />
    </h2>
  );
}

// ── Sidebar card ───────────────────────────────────────────────────────────
function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
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
    try { return JSON.parse(listing.amenities); } catch { return []; }
  })();

  // ── Parse scrapedExtras ─────────────────────────────────────────────────
  const extras =
    listing.scrapedExtras && typeof listing.scrapedExtras === "object" && !Array.isArray(listing.scrapedExtras)
      ? (listing.scrapedExtras as Record<string, unknown>)
      : {};

  const homeFeatures: string[] = Array.isArray(extras.homeFeatures) ? (extras.homeFeatures as string[]) : [];
  const buildingAmenities: string[] = Array.isArray(extras.buildingAmenities) ? (extras.buildingAmenities as string[]) : [];
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
  const contactCompany = (extras.listedBy as string | undefined) ?? brokerExtras?.company ?? null;
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
      <div className="relative">
      {photos.length > 0 ? (
        <ListingPhotoGallery photos={photos} source={listing.source} address={listing.address} />
      ) : (
        <div className="relative w-full" style={{ height: "clamp(260px, 40vw, 480px)" }}>
          <div
            className="w-full h-full flex items-end pb-10 pl-10"
            style={{ background: "linear-gradient(135deg, #E8E0D5 0%, #C8BAA8 50%, #D4C9B8 100%)" }}
          >
            <span className="font-serif text-9xl font-bold text-white/25 select-none leading-none">
              {(listing.neighborhood ?? listing.borough ?? "NYC")[0]}
            </span>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          <div className="absolute top-5 left-5">
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
          <div className="absolute top-5 right-5">
            <span className="bg-white/90 backdrop-blur-sm text-[var(--muted)] text-[10px] font-semibold uppercase tracking-widest px-3 py-1.5 rounded-full border border-white/50 shadow-sm">
              {listing.source}
            </span>
          </div>
        </div>
      )}
      {/* Photo score badge — overlaid on gallery */}
      {photoScore != null && (
        <div className="absolute bottom-4 left-4 z-10">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-sm shadow-sm border ${
            photoScore >= 4
              ? "bg-emerald-900/80 text-emerald-100 border-emerald-700"
              : photoScore === 3
              ? "bg-yellow-900/80 text-yellow-100 border-yellow-700"
              : "bg-rose-900/80 text-rose-100 border-rose-700"
          }`}>
            📷 {photoScore >= 4 ? "Photos look accurate" : photoScore === 3 ? "Some staging/wide-angle" : "Photos may be misleading"}
          </span>
        </div>
      )}
      </div>

      {/* ── Main content ── */}
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10 animate-fade-in">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-10 xl:gap-14">

          {/* ═══ LEFT — primary content ═══════════════════════════════════════ */}
          <div>
            {/* Price + No Fee badge */}
            <div className="flex flex-wrap items-baseline gap-3 mb-2">
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

            {/* Address */}
            {listing.address && (
              <p className="text-[var(--muted)] text-base mb-4">
                {listing.address}
                {listing.zip && `, ${listing.zip}`}
              </p>
            )}

            {/* Neighborhood / borough pills */}
            {(listing.neighborhood || listing.borough) && (
              <div className="flex flex-wrap gap-2 mb-7">
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

            {/* Specs bar */}
            {specs.length > 0 && (
              <div className="flex flex-wrap gap-10 py-5 border-t border-b border-[var(--border)] mb-9">
                {specs.map((s) => (
                  <div key={s.label}>
                    <p className="font-serif text-2xl font-semibold text-[var(--foreground)] leading-none">{s.value}</p>
                    <p className="text-[11px] text-[var(--muted)] uppercase tracking-wider mt-1">{s.label}</p>
                  </div>
                ))}
                {availableText && (
                  <div>
                    <p className="font-serif text-2xl font-semibold text-[var(--foreground)] leading-none capitalize">
                      {availableText.toLowerCase().startsWith("available") ? availableText.replace(/^available\s*/i, "") || "Now" : availableText}
                    </p>
                    <p className="text-[11px] text-[var(--muted)] uppercase tracking-wider mt-1">available</p>
                  </div>
                )}
              </div>
            )}

            {/* Description */}
            {listing.description && (
              <section className="mb-10">
                <SectionHeading>About this listing</SectionHeading>
                <p className="text-[var(--muted)] leading-relaxed text-sm whitespace-pre-line">
                  {listing.description}
                </p>
              </section>
            )}

            {/* ── In this unit ── */}
            {homeFeatures.length > 0 && (
              <section className="mb-10">
                <SectionHeading>In this unit</SectionHeading>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2.5 gap-x-4">
                  {homeFeatures.map((f) => (
                    <div key={f} className="flex items-start gap-2 text-sm text-[var(--foreground)]">
                      <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0" />
                      <span className="leading-snug">{f}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── Building amenities ── */}
            {buildingAmenities.length > 0 && (
              <section className="mb-10">
                <SectionHeading>Building amenities</SectionHeading>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2.5 gap-x-4">
                  {buildingAmenities.map((a) => (
                    <div key={a} className="flex items-start gap-2 text-sm text-[var(--foreground)]">
                      <span className="mt-[5px] w-1.5 h-1.5 rounded-full bg-[var(--muted-light)] shrink-0" />
                      <span className="leading-snug">{a}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* CSS amenities — fallback when no extras */}
            {cssAmenities.length > 0 && homeFeatures.length === 0 && buildingAmenities.length === 0 && (
              <section className="mb-10">
                <SectionHeading>Amenities</SectionHeading>
                <div className="flex flex-wrap gap-2">
                  {cssAmenities.map((a) => (
                    <span key={a} className="text-xs bg-[var(--card)] text-[var(--muted)] border border-[var(--border)] px-3 py-1.5 rounded-lg">
                      {a}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {/* ── Public transit ── */}
            {transit.length > 0 && (
              <section className="mb-10">
                <SectionHeading>Getting around</SectionHeading>
                <div className="space-y-0">
                  {transit.map((t, i) => {
                    const stationName = t.name ?? t.station ?? "";
                    const lines = parseLines(t.lines);
                    return (
                      <div
                        key={i}
                        className="flex items-center gap-3 py-3 border-b border-[var(--border)] last:border-0"
                      >
                        {/* Line badges */}
                        <div className="flex gap-1 shrink-0 w-[88px]">
                          {lines.map((l) => (
                            <SubwayLine key={l} line={l} />
                          ))}
                        </div>
                        {/* Station name */}
                        <span className="text-sm text-[var(--foreground)] flex-1 leading-snug">{stationName}</span>
                        {/* Distance + walk time */}
                        <div className="flex items-center gap-2.5 shrink-0 text-right">
                          {t.distance && (
                            <span className="text-xs text-[var(--muted)]">{t.distance}</span>
                          )}
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

            {/* ── Nearby schools ── */}
            {schools.length > 0 && (
              <section className="mb-10">
                <SectionHeading>Nearby schools</SectionHeading>
                <div className="space-y-0">
                  {schools.map((s, i) => {
                    const name = s.name.length > 4 && s.name === s.name.toUpperCase()
                      ? s.name.charAt(0) + s.name.slice(1).toLowerCase()
                      : s.name;
                    return (
                      <div key={i} className="flex items-start justify-between gap-4 py-3.5 border-b border-[var(--border)] last:border-0">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--foreground)] leading-snug">{name}</p>
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

            {/* ── Fee breakdown ── */}
            {fees && (fees.applicationFee || fees.securityDeposit || (fees.monthlyFees && fees.monthlyFees.length > 0)) && (
              <section className="mb-10">
                <SectionHeading>Fee breakdown</SectionHeading>
                <div className="rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--card)]">
                  {/* One-time */}
                  {(fees.applicationFee || fees.securityDeposit || (fees.brokerFee != null && fees.brokerFee > 0)) && (
                    <div className="px-5 py-4 border-b border-[var(--border)]">
                      <p className="text-[10px] font-semibold text-[var(--muted)] uppercase tracking-widest mb-3">One-time</p>
                      <div className="space-y-2.5">
                        {fees.applicationFee != null && fees.applicationFee > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-[var(--muted)]">Application fee</span>
                            <span className="font-medium text-[var(--foreground)]">${fees.applicationFee}</span>
                          </div>
                        )}
                        {fees.securityDeposit != null && fees.securityDeposit > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-[var(--muted)]">Security deposit</span>
                            <span className="font-medium text-[var(--foreground)]">
                              ${fees.securityDeposit.toLocaleString()}
                              <span className="text-xs text-[var(--muted-light)] font-normal ml-1">refundable</span>
                            </span>
                          </div>
                        )}
                        {fees.brokerFee != null && fees.brokerFee > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-[var(--muted)]">Broker fee</span>
                            <span className="font-medium text-[var(--foreground)]">${fees.brokerFee.toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {/* Optional monthly */}
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

          {/* ═══ RIGHT — sidebar ══════════════════════════════════════════════ */}
          <div className="space-y-4">

            {/* CTA */}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
              {listing.rentGross != null && (
                <p className="font-serif text-3xl font-bold text-[var(--foreground)] mb-1">
                  ${listing.rentGross.toLocaleString()}
                  <span className="text-sm font-sans font-normal text-[var(--muted-light)] ml-1">/mo</span>
                </p>
              )}
              {listing.address && (
                <p className="text-sm text-[var(--muted)] mb-4 leading-snug">{listing.address}</p>
              )}
              <TrackOutbound
                listingId={listing.id}
                href={listing.sourceUrl}
                className="w-full flex items-center justify-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
              >
                View on {listing.source}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </TrackOutbound>
            </div>

            {/* At a glance — policies, availability, concessions */}
            {(isNoFee || policies?.pets || policies?.smoking || policies?.guarantors || availableText || concessionsDisplay.length > 0) && (
              <SideCard title="At a glance">
                <dl className="space-y-2.5 text-sm">
                  {isNoFee && (
                    <div className="flex justify-between gap-2 items-center">
                      <dt className="text-[var(--muted)]">Broker fee</dt>
                      <dd className="font-semibold text-emerald-700">No fee ✓</dd>
                    </div>
                  )}
                  {availableText && (
                    <div className="flex justify-between gap-2 items-start">
                      <dt className="text-[var(--muted)] shrink-0">Available</dt>
                      <dd className="font-medium text-[var(--foreground)] text-right capitalize">{availableText}</dd>
                    </div>
                  )}
                  {policies?.pets && (
                    <div className="flex justify-between gap-2 items-start">
                      <dt className="text-[var(--muted)] shrink-0">Pets</dt>
                      <dd className="font-medium text-[var(--foreground)] text-right capitalize">{policies.pets}</dd>
                    </div>
                  )}
                  {policies?.smoking && (
                    <div className="flex justify-between gap-2 items-start">
                      <dt className="text-[var(--muted)] shrink-0">Smoking</dt>
                      <dd className="font-medium text-[var(--foreground)] text-right capitalize">{policies.smoking}</dd>
                    </div>
                  )}
                  {policies?.guarantors && (
                    <div className="flex justify-between gap-2 items-start">
                      <dt className="text-[var(--muted)] shrink-0">Guarantors</dt>
                      <dd className="font-medium text-[var(--foreground)] text-right capitalize">{policies.guarantors}</dd>
                    </div>
                  )}
                  {concessionsDisplay.length > 0 && (
                    <div className="pt-2 mt-1 border-t border-[var(--border)] space-y-2.5">
                      {concessionsDisplay.map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-2 items-start">
                          <dt className="text-[var(--muted)] capitalize leading-snug">
                            {k.replace(/([A-Z])/g, " $1").toLowerCase().trim()}
                          </dt>
                          <dd className="font-medium text-[var(--foreground)] text-right text-xs leading-snug">{String(v)}</dd>
                        </div>
                      ))}
                    </div>
                  )}
                </dl>
              </SideCard>
            )}

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
              <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
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
                  <p className="text-sm text-[var(--foreground)] leading-relaxed mb-4 italic">
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

            {/* Metadata */}
            <SideCard title="Details">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--muted)]">Source</dt>
                  <dd className="font-medium text-[var(--foreground)]">{listing.source}</dd>
                </div>
                {listing.status && (
                  <div className="flex justify-between gap-4 items-center">
                    <dt className="text-[var(--muted)]">Status</dt>
                    <dd>
                      <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                        listing.status === "active"
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]"
                      }`}>
                        {listing.status}
                      </span>
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--muted)]">Last seen</dt>
                  <dd className="font-medium text-[var(--foreground)]">{scrapedDate}</dd>
                </div>
              </dl>
            </SideCard>
          </div>

        </div>
      </div>
    </div>
  );
}

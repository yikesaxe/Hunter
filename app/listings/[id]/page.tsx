import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import { TrackOutbound } from "@/app/components/TrackOutbound";
import { ListingPhotoGallery } from "@/app/components/ListingPhotoGallery";

export default async function ListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const listing = await prisma.normalizedListing.findUnique({
    where: { id },
    include: {
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

  const photos: string[] = (() => {
    try { return JSON.parse(listing.photos); } catch { return []; }
  })();
  const amenities: string[] = (() => {
    try { return JSON.parse(listing.amenities); } catch { return []; }
  })();


  const specs = [
    listing.beds != null && `${listing.beds} ${listing.beds === 1 ? "bed" : "beds"}`,
    listing.baths != null && `${listing.baths} ${listing.baths === 1 ? "bath" : "baths"}`,
    listing.sqft != null && `${listing.sqft.toLocaleString()} sqft`,
  ].filter(Boolean) as string[];

  const availableDate = listing.availableFrom
    ? new Date(listing.availableFrom).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;
  const scrapedDate = new Date(listing.lastScrapedAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* Photo gallery — hero + thumbnails (client component for interactivity) */}
      {photos.length > 0 ? (
        <ListingPhotoGallery
          photos={photos}
          source={listing.source}
          address={listing.address}
        />
      ) : (
        <div className="relative w-full bg-[var(--surface)]" style={{ height: "clamp(280px, 44vw, 560px)" }}>
          <div
            className="w-full h-full flex items-end pb-10 pl-10"
            style={{ background: "linear-gradient(135deg, #E8E0D5 0%, #C8BAA8 50%, #D4C9B8 100%)" }}
          >
            <span className="font-serif text-8xl font-bold text-white/30 select-none leading-none">
              {(listing.neighborhood ?? listing.borough ?? "NYC")[0]}
            </span>
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
          <div className="absolute top-5 left-5">
            <a href="/" className="inline-flex items-center gap-1.5 bg-white/90 backdrop-blur-sm text-[var(--foreground)] text-sm font-medium px-3 py-1.5 rounded-full border border-white/50 hover:bg-white transition-colors shadow-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
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

      {/* Main content */}
      <div className="mx-auto max-w-6xl px-5 sm:px-8 py-10 animate-fade-in">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-10">

          {/* Left: primary info */}
          <div>
            {/* Price */}
            {listing.rentGross != null && (
              <p className="font-serif text-5xl font-bold text-[var(--accent)] leading-none mb-4">
                ${listing.rentGross.toLocaleString()}
                <span className="text-xl font-sans font-normal text-[var(--muted-light)] ml-2">/mo</span>
              </p>
            )}

            {/* Address */}
            {listing.address && (
              <p className="text-[var(--muted)] text-base mb-4">
                {listing.address}
                {listing.zip && `, ${listing.zip}`}
              </p>
            )}

            {/* Neighborhood / borough tags */}
            {(listing.neighborhood || listing.borough) && (
              <div className="flex flex-wrap gap-2 mb-6">
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

            {/* Specs */}
            {specs.length > 0 && (
              <div className="flex flex-wrap gap-4 mb-8 py-5 border-t border-b border-[var(--border)]">
                {specs.map((spec) => (
                  <div key={spec} className="text-center">
                    <p className="font-serif text-xl font-semibold text-[var(--foreground)]">{spec.split(" ")[0]}</p>
                    <p className="text-xs text-[var(--muted)] uppercase tracking-wider mt-0.5">{spec.split(" ").slice(1).join(" ")}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Description */}
            {listing.description && (
              <div className="mb-8">
                <h2 className="font-serif text-lg font-semibold text-[var(--foreground)] mb-3">About this listing</h2>
                <p className="text-[var(--muted)] leading-relaxed whitespace-pre-line text-sm">
                  {listing.description}
                </p>
              </div>
            )}

            {/* Amenities */}
            {amenities.length > 0 && (
              <div>
                <h2 className="font-serif text-lg font-semibold text-[var(--foreground)] mb-3">Amenities</h2>
                <div className="flex flex-wrap gap-2">
                  {amenities.map((a) => (
                    <span
                      key={a}
                      className="text-xs bg-[var(--card)] text-[var(--muted)] border border-[var(--border)] px-3 py-1.5 rounded-lg"
                    >
                      {a}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: sidebar */}
          <div className="space-y-4">
            {/* CTA card */}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
              {listing.rentGross != null && (
                <p className="font-serif text-3xl font-bold text-[var(--foreground)] mb-1">
                  ${listing.rentGross.toLocaleString()}
                  <span className="text-sm font-sans font-normal text-[var(--muted-light)] ml-1">/mo</span>
                </p>
              )}
              {listing.address && (
                <p className="text-sm text-[var(--muted)] mb-4">{listing.address}</p>
              )}
              <TrackOutbound
                listingId={listing.id}
                href={listing.sourceUrl}
                className="w-full flex items-center justify-center gap-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-semibold px-4 py-2.5 rounded-lg transition-colors"
              >
                View on {listing.source}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </TrackOutbound>
            </div>

            {/* Broker info */}
            {(listing.brokerName || listing.brokerPhone || listing.brokerEmail) && (
              <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
                <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">Contact</h3>
                {listing.brokerName && (
                  <p className="font-medium text-[var(--foreground)] text-sm mb-1">{listing.brokerName}</p>
                )}
                {listing.brokerPhone && (
                  <a href={`tel:${listing.brokerPhone}`} className="block text-sm text-[var(--accent)] hover:underline mb-1">
                    {listing.brokerPhone}
                  </a>
                )}
                {listing.brokerEmail && (
                  <a href={`mailto:${listing.brokerEmail}`} className="block text-sm text-[var(--accent)] hover:underline break-all">
                    {listing.brokerEmail}
                  </a>
                )}
              </div>
            )}

            {/* Also listed on — cross-source dedup */}
            {siblingPostings.length > 0 && (
              <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
                <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">Also listed on</h3>
                <ul className="space-y-2">
                  {siblingPostings.map((sibling) => (
                    <li key={sibling.id}>
                      <a
                        href={`/listings/${sibling.id}`}
                        className="flex items-center justify-between text-sm hover:text-[var(--accent)] transition-colors"
                      >
                        <span className="font-medium capitalize">{sibling.source}</span>
                        {sibling.rentGross != null && (
                          <span className="text-[var(--muted)]">${sibling.rentGross.toLocaleString()}/mo</span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Metadata */}
            <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 shadow-sm">
              <h3 className="text-xs font-semibold text-[var(--muted)] uppercase tracking-wider mb-3">Details</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--muted)]">Source</dt>
                  <dd className="font-medium text-[var(--foreground)] text-right">{listing.source}</dd>
                </div>
                {listing.status && (
                  <div className="flex justify-between gap-4">
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
                {availableDate && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-[var(--muted)]">Available</dt>
                    <dd className="font-medium text-[var(--foreground)] text-right">{availableDate}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--muted)]">Last seen</dt>
                  <dd className="font-medium text-[var(--foreground)] text-right">{scrapedDate}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

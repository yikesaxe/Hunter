# Recommendation & Personalization — App Audit

This document gathers app-specific details for building recommendation and personalization logic.

---

## A) Tech stack & runtime

### 1. Frontend framework & routing
- **Framework**: Next.js 15, React 19.
- **Routing**: App Router only (`app/`).
- **UI**: Tailwind CSS; Playfair Display (serif) + DM Sans (sans) via Google Fonts.
- **Key routes**: `/` (listings), `/listings/[id]` (detail), `/runs` (crawl runs), `/onboarding` (preferences flow).

### 2. Backend
- **API**: Next.js Route Handlers only (no separate Express/Fastify).
- **Routes**: `GET /api/listings`, `GET /api/listings/[id]`, `GET /api/runs`, `GET /api/sources`.
- **Serverless**: Not specified; typically Vercel or Node server depending on deployment.

### 3. Database & ORM
- **Database**: PostgreSQL.
- **ORM**: Prisma 7 with `@prisma/adapter-pg` (native PG driver).
- **Client**: Shared Prisma client in `lib/db.ts` (Next.js) and `scraper/src/db.ts` (worker); same schema at repo root (`prisma/schema.prisma`).

### 4. Auth & user model
- **Auth**: None. No Clerk, Auth0, NextAuth, or custom auth.
- **User model**: None. No user table or session; preferences are client-only (see below).

### 5. Hosting & background jobs
- **Hosting**: Not configured in repo (no Vercel/AWS config committed).
- **Queue**: BullMQ + Redis (`REDIS_URL`, default `redis://localhost:6379`).
- **Workers**: Long-running Node process via `npm run worker` (crawl-index + scrape-listing workers).
- **Cron / scheduled ingestion**: None. Crawls are triggered manually: `npm run enqueue "<url>" -- --max=N`.

---

## B) Current ingestion pipeline

### 6. Where listings are stored & sample record

**Table**: `Listing` (Prisma model `Listing`).

| Field | Type | Notes |
|-------|------|--------|
| id | String (uuid) | PK |
| source | String | e.g. "streeteasy", "zillow" |
| sourceListingId | String? | From URL/site; used for dedup with source |
| url | String | Canonical listing URL |
| canonicalUrl | String? | Same as url in current code |
| title | String? | |
| address | String? | |
| neighborhood | String? | |
| borough | String? | |
| city | String | Default "New York" |
| state | String | Default "NY" |
| zip | String? | |
| latitude | Float? | From page/JSON-LD, not geocoding API |
| longitude | Float? | |
| price | Int? | Monthly rent |
| priceDelta | Int? | Positive = increase, negative = drop (StreetEasy) |
| beds | Float? | 0 = studio |
| baths | Float? | |
| sqft | Int? | |
| description | String? | Truncated to ~300 chars in parser |
| amenities | String | JSON array string (from parser `features`) |
| photos | String | JSON array of image URLs |
| brokerName | String? | Not populated by current parsers |
| brokerPhone | String? | |
| brokerEmail | String? | |
| listedAt | DateTime? | Not reliably set |
| status | String | Default "active"; never set to "inactive" by current code |
| firstSeenAt | DateTime | Set on create |
| lastSeenAt | DateTime | Set on every upsert |
| lastScrapedAt | DateTime | Set on every upsert |
| contentHash | String | SHA-256 of key fields for change detection |
| raw | String | JSON; currently borough + extractedBy |
| createdAt / updatedAt | DateTime | |

**Sample listing (JSON shape returned by API):**
```json
{
  "id": "uuid",
  "source": "streeteasy",
  "sourceListingId": "1234567",
  "url": "https://streeteasy.com/rental/1234567",
  "title": "2 Bed in Chelsea",
  "address": "123 W 20th St",
  "neighborhood": "Chelsea",
  "borough": "Manhattan",
  "city": "New York",
  "state": "NY",
  "zip": "10011",
  "latitude": 40.742,
  "longitude": -73.998,
  "price": 4200,
  "priceDelta": -200,
  "beds": 2,
  "baths": 2,
  "sqft": 1100,
  "description": "Spacious...",
  "amenities": "[\"Doorman\",\"Elevator\"]",
  "photos": "[\"https://...\"]",
  "brokerName": null,
  "brokerPhone": null,
  "brokerEmail": null,
  "listedAt": null,
  "status": "active",
  "firstSeenAt": "2025-01-01T00:00:00.000Z",
  "lastSeenAt": "2025-02-01T00:00:00.000Z",
  "lastScrapedAt": "2025-02-01T00:00:00.000Z",
  "contentHash": "abc...",
  "raw": "{}",
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Dedup**: Unique on `(source, sourceListingId)` when `sourceListingId` is set; otherwise first match by `(source, url)` then create.

### 7. Sources & fields extracted per source

Detection: `detectSource(url)` by domain → `leasebreak`, `streeteasy`, `zillow`, `renthop`, `apartments.com`, or `unknown`.

| Source | Reliably extracted | Notes |
|--------|--------------------|--------|
| **leasebreak** | address/title (h2), neighborhood/borough (title-detail), beds/baths (title-icon + nums-icon), price, photos | Sublets/short-term focused. |
| **streeteasy** | sourceListingId (URL), address (data-testid="address"), price (priceInfo h4), priceDelta (pill-priceDrop/Increase), beds/baths/sqft (propertyDetails, avoiding $ lines), neighborhood (buildingSummaryList), photos (image.streeteasy.com) | Beds/baths intentionally not from JSON-LD. |
| **zillow** | address/title from script Redux/preloaded JSON; price; beds/baths from JSON or heuristics; photos (zillowstatic, excluding maps.googleapis static map) | JSON embedded in script tags. |
| **renthop** | sourceListingId (URL), title (h1), address (listing-address/h2/h1), price, neighborhood (location/breadcrumb), photos (renthopcdn) | No dedicated beds/baths selectors; can fall back to heuristics. |
| **apartments.com** | sourceListingId (URL), title (h1 / data-testid), address, price, beds/baths (priceBedRangeInfo / class patterns), neighborhood, photos | |

**Generic fallbacks** (all sources): JSON-LD (name, description, address, geo, offers/price, bedrooms/bathrooms, image), meta tags (og:title, og:description, geo.position, og:image), and body-text heuristics (price /mo, bed/bath/sqft regex). NYC rent floor: 800 (below that price is nulled).

### 8. Ingestion frequency & active/inactive

- **Frequency**: On-demand only. No cron. User runs `npm run enqueue "https://..." -- --max=N`; worker processes jobs.
- **Active/inactive**: `status` exists on `Listing` (default `"active"`) and is indexed. **Current code always writes `status: "active"` on upsert.** There is no job or logic that sets a listing to `"inactive"` when it no longer appears in a crawl (e.g. listing removed from source). So today, “inactive” is unused; all stored listings remain active indefinitely.

### 9. Geocoding

- **No geocoding API.** Latitude/longitude come only from:
  - JSON-LD `geo` on the listing page
  - Meta tags `geo.position` / `ICBM`
- **Not from**: Mapbox, Google Maps Geocoding, or any external geocoding provider.
- **Stored**: `latitude`, `longitude` (nullable). Neighborhood is from page content (or JSON-LD `addressLocality`), not derived from coordinates.

---

## C) Product requirements

### 10. User preferences (current)

**Where set**: Onboarding flow (`/onboarding`) → saved to **localStorage** only as `hunter_prefs` (no server, no user account).

**Preference object (TypeScript / JSON):**
```ts
type Prefs = {
  name: string;           // "What should we call you?"
  minPrice: number;       // slider 500–9500, step 100
  maxPrice: number;       // slider 1000–10000, step 100
  beds: number[];         // 0=Studio, 1, 2, 3, 4+ (multi-select chips)
  neighborhoods: string[]; // Manhattan list (ManhattanNeighborhoodSelector); other boroughs not in current step-2 UI
  amenities: string[];    // Multi-select: Doorman, Elevator, In-unit laundry, Dishwasher, Pet-friendly, Gym, Rooftop, Outdoor space, Parking, Storage, No broker fee, Concierge
  moveIn: string;        // Single: "asap" | "30" | "60" | "90" | "flexible" (labels: ASAP, 30 days, 60 days, 90+ days, Flexible)
  notes: string;         // Free text, optional ("e.g. south-facing, below 4th floor...")
};
```

**Example JSON:**
```json
{
  "name": "Alex",
  "minPrice": 2000,
  "maxPrice": 5000,
  "beds": [0, 1],
  "neighborhoods": ["Chelsea", "West Village", "Greenwich Village"],
  "amenities": ["Doorman", "Elevator"],
  "moveIn": "30",
  "notes": "South-facing preferred"
}
```

**Not collected today**: Commute (work address, max time), pets (beyond “Pet-friendly” amenity), lease length, broker-fee preference (only “No broker fee” as amenity).

**Usage**: Preferences are **not** used to filter or rank the listing feed. The listings page has its own filters (search `q`, source, minPrice, maxPrice) and does not read `hunter_prefs`. So prefs are “saved for later” but not yet applied.

### 11. Success definition & events

- **No success metric implemented.** No tracking of: clicks on listings, saves/favorites, contact clicks, applications, or any other event.
- **No analytics or event pipeline** in the codebase (no event API, no analytics SDK).
- **Define “success”** (for later): e.g. click-through to listing detail, click to source site, save/favorite, contact/apply. All of these would require new event capture and (optionally) a user or device identity.

### 12. Constraints: must-haves vs nice-to-haves

- **Not yet defined in product.** The app does not distinguish:
  - **Hard filters** (must satisfy: e.g. price in range, bedroom in list, neighborhood in list)
  - **Soft scoring** (nice-to-have: amenities, move-in, notes)
- **Current API**: `GET /api/listings` supports only exact filters: `q` (text search), `source`, `minPrice`, `maxPrice`, `neighborhood` (contains), `limit`. No scoring, no “preference match” score, no ordering by fit-to-prefs.
- **For recommendations**: You can define e.g. budget + beds + neighborhoods as hard filters, and amenities + move-in + notes as soft signals for ranking or a “match score.”

---

## Summary for recommendation/personalization

| Topic | Current state |
|-------|----------------|
| **Users** | No auth; no user table; prefs in localStorage only. |
| **Preferences** | Collected (budget, beds, neighborhoods, amenities, move-in, notes) but not used for listing feed. |
| **Listings** | Single `Listing` table; status always “active”; no inactivation when listing disappears from crawl. |
| **Geocoding** | None; lat/lng only from page/JSON-LD. |
| **Events** | None; no clicks, saves, or applications. |
| **Filtering/ranking** | Listings API: exact filters only; no preference-based scoring or ranking. |

**Next steps for recommendation logic:**  
(1) Persist preferences (e.g. DB + optional auth or anonymous id).  
(2) Use prefs in listing API: hard filters (price, beds, neighborhoods) and optional soft scoring (amenities, move-in, notes).  
(3) Optionally add geocoding for commute/distance.  
(4) Optionally add “last seen” / crawl-based inactivation so old listings can be marked inactive.  
(5) Define and implement success events (click, save, contact) for future personalization.

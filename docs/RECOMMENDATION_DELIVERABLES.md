# Recommendation & Personalization — Deliverables

## Files changed/added

### New files
- `lib/deviceId.ts` — read/create `hid` cookie
- `lib/device.ts` — get or create Device in DB, cookie options
- `lib/validation/prefs.ts` — zod schema for preferences
- `lib/normalize/amenities.ts` — parse + normalize listing amenities (synonyms → canonical)
- `lib/normalize/amenities.test.ts` — tests for parse, normalize, canonical
- `lib/recs/types.ts` — PrefsForScoring, ListingForScoring, WeightsProfile, ScoreBreakdown
- `lib/recs/score.ts` — passesHardFilters, scoreListing
- `lib/recs/score.test.ts` — tests for hard filters and scoring
- `lib/recs/reasons.ts` — getMatchReasons (top 3)
- `lib/recs/reasons.test.ts` — tests for reasons
- `lib/recs/learn.ts` — learnFromEvent (update DeviceProfile weights)
- `app/api/prefs/route.ts` — GET /api/prefs, POST /api/prefs
- `app/api/events/route.ts` — POST /api/events (impression, click, save, hide, outbound)
- `app/api/profile/route.ts` — GET /api/profile (weights + stats)
- `app/components/TrackOutbound.tsx` — client link that sends outbound event
- `prisma/migrations/20260219000000_add_device_prefs_events_profile/migration.sql` — migration for Device, Preference, Event, DeviceProfile
- `vitest.config.ts` — vitest config with `@` alias
- `docs/RECOMMENDATION_DELIVERABLES.md` — this file

### Modified files
- `prisma/schema.prisma` — added Device, Preference, Event, DeviceProfile; Listing.events relation
- `app/api/listings/route.ts` — mode=recommended (hard filters + scoring, matchScore/matchReasons, impressions)
- `app/components/Onboarding.tsx` — POST prefs on launch, hydrate from GET /api/prefs when localStorage empty
- `app/components/ListingsPage.tsx` — For You / Search toggle, recommended fetch, click/save/hide events, matchReasons UI, hiddenIds
- `app/listings/[id]/page.tsx` — TrackOutbound for “View on {source}”
- `app/components/ManhattanNeighborhoodSelector.tsx` — removed invalid `ringColor` style (build fix)
- `package.json` — added zod, vitest, scripts test / test:watch

---

## Migrations

- **Migration**: `prisma/migrations/20260219000000_add_device_prefs_events_profile/migration.sql`
- **Apply**: With `DATABASE_URL` set, run:
  ```bash
  npx prisma migrate deploy
  ```
  Or for dev:
  ```bash
  npm run prisma:migrate
  ```

---

## How to run locally

1. **Env**
   - `DATABASE_URL` — Postgres connection string (required for app and build).
   - `REDIS_URL` — optional for this feature (only needed for scraper workers).

2. **DB**
   ```bash
   npm run prisma:generate
   npx prisma migrate deploy
   ```

3. **Seed prefs (optional)**  
   Complete onboarding at `/onboarding` (prefs are stored in DB and localStorage), or insert a Preference row for a Device (create Device first, then Preference with that deviceId).

4. **Run app**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`.

5. **Recommended feed**
   - Go to `/onboarding`, complete steps, click “Start Hunting” (creates Device + Preference).
   - On home, switch to **For You** or call:
   ```text
   GET /api/listings?mode=recommended&limit=20
   ```
   (Send cookie `hid` or let the API set it.)

6. **Tests**
   ```bash
   npm run test
   ```

---

## Example JSON response (recommended listings)

```json
[
  {
    "id": "uuid",
    "source": "streeteasy",
    "url": "https://streeteasy.com/...",
    "title": "2 Bed in Chelsea",
    "address": "123 W 20th St",
    "neighborhood": "Chelsea",
    "borough": "Manhattan",
    "price": 4200,
    "beds": 2,
    "baths": 2,
    "amenities": "[\"Doorman\",\"Elevator\"]",
    "photos": "[...]",
    "lastSeenAt": "2025-02-19T...",
    "status": "active",
    "matchScore": 78,
    "matchReasons": [
      "Matches your budget",
      "In Chelsea",
      "Has Doorman + Elevator"
    ]
  }
]
```

With `?debug=1` each listing also includes:

```json
"scoreBreakdown": {
  "budgetFit": 20,
  "bedsFit": 15,
  "neighborhoodBoost": 20,
  "amenitiesMatch": 15,
  "recency": 8,
  "completeness": 8,
  "total": 78,
  "weightMultiplier": 1
}
```

---

## Summary

- **Anonymous identity**: `hid` httpOnly cookie; Device row created on first use.
- **Preferences**: GET/POST `/api/prefs`; onboarding writes to DB and localStorage, hydrates from API when localStorage is empty.
- **Recommendations**: `GET /api/listings?mode=recommended` applies hard filters (price, beds, neighborhoods, status), scores with budget/beds/neighborhood/amenities/recency/completeness, uses DeviceProfile weights when present, returns `matchScore` and `matchReasons`; impressions logged with 6h cooldown per device/listing.
- **Events**: POST `/api/events` with `listingId`, `type` (impression, click, save, hide, outbound); save/hide/click update DeviceProfile weights via `learnFromEvent`.
- **Explainability**: Each recommended listing includes `matchScore` and `matchReasons` (top 3); optional `scoreBreakdown` with `?debug=1`.
- **Tests**: Vitest; scoring, amenity normalization, reasons, and JSON parse safety for amenities.

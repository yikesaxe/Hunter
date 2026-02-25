-- Smart Crawler Schema Migration
-- Replaces flat Listing table with canonicalized:
--   RawListing -> NormalizedListing -> CanonicalUnit (+ ChangeLog, CrawlJob, CrawlRunSeen)

-- ============================================================
-- 1. Drop tables that reference Listing (Event) then Listing itself
-- ============================================================

DROP TABLE IF EXISTS "Event";
DROP TABLE IF EXISTS "Listing";

-- ============================================================
-- 2. CanonicalUnit (no FKs, create first)
-- ============================================================

CREATE TABLE "CanonicalUnit" (
    "id"                  TEXT NOT NULL,
    "address"             TEXT,
    "unit"                TEXT,
    "neighborhood"        TEXT,
    "borough"             TEXT,
    "zip"                 TEXT,
    "latitude"            DOUBLE PRECISION,
    "longitude"           DOUBLE PRECISION,
    "beds"                DOUBLE PRECISION,
    "baths"               DOUBLE PRECISION,
    "sqft"                INTEGER,
    "activePostingsCount" INTEGER NOT NULL DEFAULT 0,
    "bestRentGross"       INTEGER,
    "lastActiveAt"        TIMESTAMP(3),
    "lastMatchScore"      INTEGER,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CanonicalUnit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CanonicalUnit_neighborhood_borough_idx" ON "CanonicalUnit"("neighborhood", "borough");
CREATE INDEX "CanonicalUnit_activePostingsCount_idx"  ON "CanonicalUnit"("activePostingsCount");
CREATE INDEX "CanonicalUnit_lastMatchScore_idx"       ON "CanonicalUnit"("lastMatchScore");

-- ============================================================
-- 3. CrawlJob (needed before NormalizedListing FK)
-- ============================================================

CREATE TABLE "CrawlJob" (
    "id"               TEXT NOT NULL,
    "deviceId"         TEXT,
    "source"           TEXT NOT NULL,
    "searchUrl"        TEXT NOT NULL,
    "searchUrlHash"    TEXT NOT NULL,
    "status"           TEXT NOT NULL DEFAULT 'idle',
    "lastRunAt"        TIMESTAMP(3),
    "nextRunAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consecutiveFails" INTEGER NOT NULL DEFAULT 0,
    "backoffUntil"     TIMESTAMP(3),
    "cursor"           TEXT,
    "totalDiscovered"  INTEGER NOT NULL DEFAULT 0,
    "totalScraped"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CrawlJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrawlJob_deviceId_source_searchUrlHash_key"
    ON "CrawlJob"("deviceId", "source", "searchUrlHash");
CREATE INDEX "CrawlJob_nextRunAt_status_idx" ON "CrawlJob"("nextRunAt", "status");
CREATE INDEX "CrawlJob_deviceId_idx"         ON "CrawlJob"("deviceId");

-- Add FK to Device (Device table already exists)
ALTER TABLE "CrawlJob"
    ADD CONSTRAINT "CrawlJob_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 4. NormalizedListing
-- ============================================================

CREATE TABLE "NormalizedListing" (
    "id"                      TEXT NOT NULL,
    "source"                  TEXT NOT NULL,
    "sourceListingId"         TEXT,
    "sourceUrl"               TEXT NOT NULL,
    "address"                 TEXT,
    "unit"                    TEXT,
    "neighborhood"            TEXT,
    "borough"                 TEXT,
    "zip"                     TEXT,
    "latitude"                DOUBLE PRECISION,
    "longitude"               DOUBLE PRECISION,
    "rentGross"               INTEGER,
    "rentNet"                 INTEGER,
    "priceDelta"              INTEGER,
    "brokerFee"               BOOLEAN,
    "brokerFeeMonths"         DOUBLE PRECISION,
    "beds"                    DOUBLE PRECISION,
    "baths"                   DOUBLE PRECISION,
    "sqft"                    INTEGER,
    "leaseTerm"               TEXT,
    "availableFrom"           TIMESTAMP(3),
    "description"             TEXT,
    "amenities"               TEXT NOT NULL DEFAULT '[]',
    "photos"                  TEXT NOT NULL DEFAULT '[]',
    "brokerName"              TEXT,
    "brokerPhone"             TEXT,
    "brokerEmail"             TEXT,
    "status"                  TEXT NOT NULL DEFAULT 'active',
    "removedAt"               TIMESTAMP(3),
    "firstSeenAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastScrapedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextScrapeAt"            TIMESTAMP(3),
    "contentHash"             TEXT,
    "consecutiveMisses"       INTEGER NOT NULL DEFAULT 0,
    "consecutiveFails"        INTEGER NOT NULL DEFAULT 0,
    "discoveredByCrawlJobId"  TEXT,
    "canonicalUnitId"         TEXT,
    "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NormalizedListing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NormalizedListing_source_sourceListingId_key"
    ON "NormalizedListing"("source", "sourceListingId");
CREATE INDEX "NormalizedListing_sourceUrl_idx"
    ON "NormalizedListing"("sourceUrl");
CREATE INDEX "NormalizedListing_source_status_idx"
    ON "NormalizedListing"("source", "status");
CREATE INDEX "NormalizedListing_status_nextScrapeAt_idx"
    ON "NormalizedListing"("status", "nextScrapeAt");
CREATE INDEX "NormalizedListing_consecutiveMisses_idx"
    ON "NormalizedListing"("consecutiveMisses");
CREATE INDEX "NormalizedListing_canonicalUnitId_idx"
    ON "NormalizedListing"("canonicalUnitId");
CREATE INDEX "NormalizedListing_discoveredByCrawlJobId_idx"
    ON "NormalizedListing"("discoveredByCrawlJobId");

ALTER TABLE "NormalizedListing"
    ADD CONSTRAINT "NormalizedListing_discoveredByCrawlJobId_fkey"
    FOREIGN KEY ("discoveredByCrawlJobId") REFERENCES "CrawlJob"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NormalizedListing"
    ADD CONSTRAINT "NormalizedListing_canonicalUnitId_fkey"
    FOREIGN KEY ("canonicalUnitId") REFERENCES "CanonicalUnit"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 5. RawListing
-- ============================================================

CREATE TABLE "RawListing" (
    "id"                  TEXT NOT NULL,
    "source"              TEXT NOT NULL,
    "sourceUrl"           TEXT NOT NULL,
    "rawData"             JSONB NOT NULL,
    "statusCode"          INTEGER NOT NULL,
    "scrapedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalizedListingId" TEXT,
    CONSTRAINT "RawListing_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RawListing_sourceUrl_scrapedAt_idx"      ON "RawListing"("sourceUrl", "scrapedAt");
CREATE INDEX "RawListing_normalizedListingId_idx"       ON "RawListing"("normalizedListingId");

ALTER TABLE "RawListing"
    ADD CONSTRAINT "RawListing_normalizedListingId_fkey"
    FOREIGN KEY ("normalizedListingId") REFERENCES "NormalizedListing"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================
-- 6. ChangeLog
-- ============================================================

CREATE TABLE "ChangeLog" (
    "id"                  TEXT NOT NULL,
    "normalizedListingId" TEXT,
    "canonicalUnitId"     TEXT,
    "changedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fields"              JSONB NOT NULL,
    "trigger"             TEXT NOT NULL,
    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChangeLog_normalizedListingId_changedAt_idx"
    ON "ChangeLog"("normalizedListingId", "changedAt");
CREATE INDEX "ChangeLog_canonicalUnitId_changedAt_idx"
    ON "ChangeLog"("canonicalUnitId", "changedAt");

ALTER TABLE "ChangeLog"
    ADD CONSTRAINT "ChangeLog_normalizedListingId_fkey"
    FOREIGN KEY ("normalizedListingId") REFERENCES "NormalizedListing"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChangeLog"
    ADD CONSTRAINT "ChangeLog_canonicalUnitId_fkey"
    FOREIGN KEY ("canonicalUnitId") REFERENCES "CanonicalUnit"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- 7. CrawlRunSeen
-- ============================================================

CREATE TABLE "CrawlRunSeen" (
    "id"         TEXT NOT NULL,
    "crawlRunId" TEXT NOT NULL,
    "sourceUrl"  TEXT NOT NULL,
    CONSTRAINT "CrawlRunSeen_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrawlRunSeen_crawlRunId_sourceUrl_key"
    ON "CrawlRunSeen"("crawlRunId", "sourceUrl");
CREATE INDEX "CrawlRunSeen_crawlRunId_idx"
    ON "CrawlRunSeen"("crawlRunId");

-- ============================================================
-- 8. Alter CrawlRun (add new columns + FK to CrawlJob)
-- ============================================================

ALTER TABLE "CrawlRun"
    ADD COLUMN IF NOT EXISTS "crawlJobId" TEXT,
    ADD COLUMN IF NOT EXISTS "mode"       TEXT NOT NULL DEFAULT 'targeted',
    ADD COLUMN IF NOT EXISTS "isComplete" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "CrawlRun_crawlJobId_idx"  ON "CrawlRun"("crawlJobId");
CREATE INDEX IF NOT EXISTS "CrawlRun_isComplete_idx"   ON "CrawlRun"("isComplete");

ALTER TABLE "CrawlRun"
    ADD CONSTRAINT "CrawlRun_crawlJobId_fkey"
    FOREIGN KEY ("crawlJobId") REFERENCES "CrawlJob"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Add FK CrawlRunSeen → CrawlRun (now CrawlRun exists)
ALTER TABLE "CrawlRunSeen"
    ADD CONSTRAINT "CrawlRunSeen_crawlRunId_fkey"
    FOREIGN KEY ("crawlRunId") REFERENCES "CrawlRun"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Add FK CrawlJob → CrawlRun is the reverse relation; nothing to add here.

-- ============================================================
-- 9. Recreate Event referencing NormalizedListing
-- ============================================================

CREATE TABLE "Event" (
    "id"                  TEXT NOT NULL,
    "deviceId"            TEXT NOT NULL,
    "normalizedListingId" TEXT NOT NULL,
    "type"                TEXT NOT NULL,
    "metadata"            JSONB,
    "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Event_deviceId_createdAt_idx"
    ON "Event"("deviceId", "createdAt");
CREATE INDEX "Event_normalizedListingId_createdAt_idx"
    ON "Event"("normalizedListingId", "createdAt");
CREATE INDEX "Event_deviceId_normalizedListingId_type_createdAt_idx"
    ON "Event"("deviceId", "normalizedListingId", "type", "createdAt");

ALTER TABLE "Event"
    ADD CONSTRAINT "Event_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Event"
    ADD CONSTRAINT "Event_normalizedListingId_fkey"
    FOREIGN KEY ("normalizedListingId") REFERENCES "NormalizedListing"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

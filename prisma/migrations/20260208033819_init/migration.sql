-- CreateTable
CREATE TABLE "RawListing" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceListingId" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "httpStatus" INTEGER,
    "rawContent" TEXT,
    "extractedJson" JSONB,
    "parseVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RawListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NormalizedListing" (
    "id" TEXT NOT NULL,
    "rawListingId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "address" TEXT,
    "unit" TEXT,
    "neighborhood" TEXT,
    "borough" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "rentGross" INTEGER,
    "rentNetEffective" INTEGER,
    "bedrooms" DOUBLE PRECISION,
    "bathrooms" DOUBLE PRECISION,
    "brokerFee" BOOLEAN,
    "leaseTermMonths" INTEGER,
    "moveInCostNotes" TEXT,
    "petPolicy" TEXT,
    "laundry" TEXT,
    "elevator" BOOLEAN,
    "doorman" BOOLEAN,
    "images" JSONB NOT NULL DEFAULT '[]',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NormalizedListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CanonicalUnit" (
    "id" TEXT NOT NULL,
    "canonicalAddress" TEXT,
    "canonicalUnit" TEXT,
    "neighborhood" TEXT,
    "borough" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "bedrooms" DOUBLE PRECISION,
    "bathrooms" DOUBLE PRECISION,
    "bestRentGross" INTEGER,
    "bestRentNetEffective" INTEGER,
    "brokerFee" BOOLEAN,
    "activeState" TEXT NOT NULL DEFAULT 'unknown',
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitPosting" (
    "id" TEXT NOT NULL,
    "canonicalUnitId" TEXT NOT NULL,
    "normalizedListingId" TEXT NOT NULL,
    "matchScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitPosting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL,
    "canonicalUnitId" TEXT NOT NULL,
    "normalizedListingId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RawListing_source_sourceUrl_key" ON "RawListing"("source", "sourceUrl");

-- CreateIndex
CREATE INDEX "NormalizedListing_borough_neighborhood_rentGross_idx" ON "NormalizedListing"("borough", "neighborhood", "rentGross");

-- CreateIndex
CREATE INDEX "NormalizedListing_lastSeenAt_idx" ON "NormalizedListing"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "NormalizedListing_source_sourceUrl_key" ON "NormalizedListing"("source", "sourceUrl");

-- CreateIndex
CREATE INDEX "CanonicalUnit_borough_neighborhood_bestRentGross_idx" ON "CanonicalUnit"("borough", "neighborhood", "bestRentGross");

-- CreateIndex
CREATE INDEX "CanonicalUnit_lastSeenAt_idx" ON "CanonicalUnit"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnitPosting_canonicalUnitId_normalizedListingId_key" ON "UnitPosting"("canonicalUnitId", "normalizedListingId");

-- AddForeignKey
ALTER TABLE "NormalizedListing" ADD CONSTRAINT "NormalizedListing_rawListingId_fkey" FOREIGN KEY ("rawListingId") REFERENCES "RawListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitPosting" ADD CONSTRAINT "UnitPosting_canonicalUnitId_fkey" FOREIGN KEY ("canonicalUnitId") REFERENCES "CanonicalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitPosting" ADD CONSTRAINT "UnitPosting_normalizedListingId_fkey" FOREIGN KEY ("normalizedListingId") REFERENCES "NormalizedListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeLog" ADD CONSTRAINT "ChangeLog_canonicalUnitId_fkey" FOREIGN KEY ("canonicalUnitId") REFERENCES "CanonicalUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChangeLog" ADD CONSTRAINT "ChangeLog_normalizedListingId_fkey" FOREIGN KEY ("normalizedListingId") REFERENCES "NormalizedListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "CanonicalUnit" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "CrawlJob" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "NormalizedListing" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "ListingAnalysis" (
    "id" TEXT NOT NULL,
    "normalizedListingId" TEXT NOT NULL,
    "summary" TEXT,
    "priceTier" TEXT,
    "redFlags" JSONB,
    "brokerSpeak" JSONB,
    "textHash" TEXT,
    "photoFlags" JSONB,
    "overallPhotoScore" INTEGER,
    "photoHash" TEXT,
    "subwayStations" JSONB,
    "complaints311" JSONB,
    "nearbyAmenities" JSONB,
    "neighborhoodMedian" INTEGER,
    "pricePercentile" INTEGER,
    "textAnalyzedAt" TIMESTAMP(3),
    "photoAnalyzedAt" TIMESTAMP(3),
    "neighborhoodAnalyzedAt" TIMESTAMP(3),
    "priceAnalyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubwayStation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SubwayStation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListingAnalysis_normalizedListingId_key" ON "ListingAnalysis"("normalizedListingId");

-- CreateIndex
CREATE INDEX "ListingAnalysis_textAnalyzedAt_idx" ON "ListingAnalysis"("textAnalyzedAt");

-- CreateIndex
CREATE INDEX "ListingAnalysis_neighborhoodAnalyzedAt_idx" ON "ListingAnalysis"("neighborhoodAnalyzedAt");

-- CreateIndex
CREATE INDEX "SubwayStation_latitude_longitude_idx" ON "SubwayStation"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "Device_id_idx" ON "Device"("id");

-- AddForeignKey
ALTER TABLE "ListingAnalysis" ADD CONSTRAINT "ListingAnalysis_normalizedListingId_fkey" FOREIGN KEY ("normalizedListingId") REFERENCES "NormalizedListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

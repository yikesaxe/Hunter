-- CreateTable
CREATE TABLE "ScrapeJob" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "query" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "targetCount" INTEGER NOT NULL DEFAULT 200,
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "ingestedCount" INTEGER NOT NULL DEFAULT 0,
    "canonicalAddedCount" INTEGER NOT NULL DEFAULT 0,
    "cursorJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrapeJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "maxRent" INTEGER,
    "minBeds" DOUBLE PRECISION,
    "borough" TEXT,
    "neighborhood" TEXT,
    "noFeePreferred" BOOLEAN,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrapeJob_source_status_idx" ON "ScrapeJob"("source", "status");

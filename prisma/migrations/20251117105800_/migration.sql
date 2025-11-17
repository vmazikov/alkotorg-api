-- CreateEnum
CREATE TYPE "AutoPickDraftStatus" AS ENUM ('PENDING', 'APPLIED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ProductScore" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "manualScore" DOUBLE PRECISION,
    "promoBoost" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "noveltyBoost" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryRule" (
    "id" SERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "volume" DOUBLE PRECISION,
    "minQty" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssortmentProfile" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "categoryWeights" JSONB NOT NULL,
    "volumeMinQty" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssortmentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoPickDraft" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL DEFAULT 0,
    "params" JSONB NOT NULL,
    "items" JSONB NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "status" "AutoPickDraftStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoPickDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductScore_productId_key" ON "ProductScore"("productId");

-- CreateIndex
CREATE INDEX "CategoryRule_category_idx" ON "CategoryRule"("category");

-- CreateIndex
CREATE INDEX "CategoryRule_category_volume_idx" ON "CategoryRule"("category", "volume");

-- CreateIndex
CREATE INDEX "AutoPickDraft_userId_createdAt_idx" ON "AutoPickDraft"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AutoPickDraft_status_createdAt_idx" ON "AutoPickDraft"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductScore" ADD CONSTRAINT "ProductScore_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutoPickDraft" ADD CONSTRAINT "AutoPickDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

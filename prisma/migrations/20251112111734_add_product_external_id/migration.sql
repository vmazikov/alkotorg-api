-- DropIndex
DROP INDEX "Product_productId_key";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "canonicalName" TEXT,
ADD COLUMN     "rawName" TEXT,
ALTER COLUMN "productId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ProductExternalId" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductExternalId_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductExternalId_productId_idx" ON "ProductExternalId"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductExternalId_externalId_key" ON "ProductExternalId"("externalId");

-- CreateIndex
CREATE INDEX "Product_canonicalName_idx" ON "Product"("canonicalName");

-- AddForeignKey
ALTER TABLE "ProductExternalId" ADD CONSTRAINT "ProductExternalId_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

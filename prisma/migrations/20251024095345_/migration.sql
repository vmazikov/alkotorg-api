/*
  Warnings:

  - A unique constraint covering the columns `[maShopId]` on the table `Store` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[maAgentId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "maAppliedAt" TIMESTAMP(3),
ADD COLUMN     "maError" TEXT,
ADD COLUMN     "maInvoiceIdHex" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "maShopId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "maAgentId" TEXT;

-- CreateIndex
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Store_maShopId_key" ON "Store"("maShopId");

-- CreateIndex
CREATE UNIQUE INDEX "User_maAgentId_key" ON "User"("maAgentId");

/*
  Warnings:

  - You are about to drop the column `createdAt` on the `StockRule` table. All the data in the column will be lost.
  - You are about to drop the column `field` on the `StockRule` table. All the data in the column will be lost.
  - You are about to drop the column `operator` on the `StockRule` table. All the data in the column will be lost.
  - You are about to drop the column `priority` on the `StockRule` table. All the data in the column will be lost.
  - You are about to drop the column `updatedAt` on the `StockRule` table. All the data in the column will be lost.
  - You are about to drop the column `value` on the `StockRule` table. All the data in the column will be lost.
  - Added the required column `priceMax` to the `StockRule` table without a default value. This is not possible if the table is not empty.
  - Added the required column `rank` to the `StockRule` table without a default value. This is not possible if the table is not empty.
  - Added the required column `stockMax` to the `StockRule` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "StockRule_priority_idx";

-- AlterTable
ALTER TABLE "StockRule" DROP COLUMN "createdAt",
DROP COLUMN "field",
DROP COLUMN "operator",
DROP COLUMN "priority",
DROP COLUMN "updatedAt",
DROP COLUMN "value",
ADD COLUMN     "priceMax" INTEGER NOT NULL,
ADD COLUMN     "rank" INTEGER NOT NULL,
ADD COLUMN     "stockMax" INTEGER NOT NULL;

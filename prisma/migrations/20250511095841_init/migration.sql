/*
  Warnings:

  - You are about to drop the column `discountPct` on the `Promo` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[article]` on the table `Product` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[phone]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `promoPrice` to the `Promo` table without a default value. This is not possible if the table is not empty.
  - Added the required column `phone` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "article" TEXT,
ADD COLUMN     "excerpt" TEXT,
ADD COLUMN     "giftPackaging" TEXT,
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "manufacturer" TEXT,
ADD COLUMN     "rawMaterials" TEXT,
ADD COLUMN     "sweetnessLevel" TEXT,
ADD COLUMN     "wineColor" TEXT,
ADD COLUMN     "wineType" TEXT;

-- AlterTable
ALTER TABLE "Promo" DROP COLUMN "discountPct",
ADD COLUMN     "comment" TEXT,
ADD COLUMN     "promoPrice" DOUBLE PRECISION NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phone" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Product_article_key" ON "Product"("article");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

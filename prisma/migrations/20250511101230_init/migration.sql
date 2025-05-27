/*
  Warnings:

  - Added the required column `volume` to the `Product` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "volume",
ADD COLUMN     "volume" DOUBLE PRECISION NOT NULL,
ALTER COLUMN "degree" SET DATA TYPE TEXT;

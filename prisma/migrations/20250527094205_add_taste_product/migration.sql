/*
  Warnings:

  - You are about to drop the column `testeProduct` on the `Product` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Product" DROP COLUMN "testeProduct",
ADD COLUMN     "tasteProduct" TEXT;

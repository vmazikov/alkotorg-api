-- CreateEnum
CREATE TYPE "OrderLogAction" AS ENUM ('CREATED', 'STATUS_CHANGED', 'ITEM_UPDATED', 'ITEM_REMOVED', 'RETURNED_TO_CART', 'ORDER_DELETED');

-- CreateEnum
CREATE TYPE "OrderLogSource" AS ENUM ('SITE', 'ADMIN_PANEL', 'MOBILE_AGENT');

-- CreateTable
CREATE TABLE "OrderLog" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "action" "OrderLogAction" NOT NULL,
    "source" "OrderLogSource" NOT NULL,
    "actorId" INTEGER,
    "actorRole" "Role",
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrderLog_orderId_createdAt_idx" ON "OrderLog"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderLog_actorId_idx" ON "OrderLog"("actorId");

-- AddForeignKey
ALTER TABLE "OrderLog" ADD CONSTRAINT "OrderLog_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLog" ADD CONSTRAINT "OrderLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

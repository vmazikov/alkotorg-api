-- CreateTable
CREATE TABLE "PriceSyncLog" (
    "id" SERIAL NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "priceChanged" INTEGER NOT NULL,
    "stockChanged" INTEGER NOT NULL,
    "added" INTEGER NOT NULL,
    "unarchived" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,

    CONSTRAINT "PriceSyncLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PriceSyncLog" ADD CONSTRAINT "PriceSyncLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

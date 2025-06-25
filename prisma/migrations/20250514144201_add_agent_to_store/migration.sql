-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "agentId" INTEGER;

-- AddForeignKey
ALTER TABLE "Store" ADD CONSTRAINT "Store_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

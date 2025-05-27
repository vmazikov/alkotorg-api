-- CreateTable
CREATE TABLE "StockRule" (
    "id" SERIAL NOT NULL,
    "field" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockRule_priority_idx" ON "StockRule"("priority");

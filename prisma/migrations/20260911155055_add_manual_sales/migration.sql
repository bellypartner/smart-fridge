-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "volumeMl" INTEGER;

-- CreateTable
CREATE TABLE "ManualSale" (
    "id" TEXT NOT NULL,
    "fridgeId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "recordedBy" TEXT,
    "note" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualSale_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ManualSale_fridgeId_idx" ON "ManualSale"("fridgeId");

-- CreateIndex
CREATE INDEX "ManualSale_batchId_idx" ON "ManualSale"("batchId");

-- CreateIndex
CREATE INDEX "ManualSale_recordedAt_idx" ON "ManualSale"("recordedAt");

-- AddForeignKey
ALTER TABLE "ManualSale" ADD CONSTRAINT "ManualSale_fridgeId_fkey" FOREIGN KEY ("fridgeId") REFERENCES "Fridge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualSale" ADD CONSTRAINT "ManualSale_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

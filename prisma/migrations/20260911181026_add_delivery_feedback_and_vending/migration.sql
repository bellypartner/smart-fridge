-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "ManualSale" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'bank_qr';

-- CreateIndex
CREATE INDEX "Feedback_source_idx" ON "Feedback"("source");

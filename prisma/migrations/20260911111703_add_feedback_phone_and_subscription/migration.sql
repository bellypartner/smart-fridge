-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "SubscriptionFeedback" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "satisfactionRating" INTEGER,
    "onTimeDeliveryRating" INTEGER,
    "goalsResultRating" INTEGER,
    "foodQualityRating" INTEGER,
    "quantityRating" INTEGER,
    "packagingRating" INTEGER,
    "recommendRating" INTEGER,
    "suggestions" TEXT,
    "additionalRequest" TEXT,
    "favoriteMeals" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionFeedback_createdAt_idx" ON "SubscriptionFeedback"("createdAt");

-- CreateTable
CREATE TABLE "QrLocation" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QrLocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QrLocation_type_idx" ON "QrLocation"("type");

-- CreateIndex
CREATE UNIQUE INDEX "QrLocation_type_location_key" ON "QrLocation"("type", "location");

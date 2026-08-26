-- AlterTable
ALTER TABLE "FridgeStock" ADD COLUMN     "quantityAllocated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quantityWasted" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "weightGrams" INTEGER;

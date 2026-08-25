import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";

export const createProduct = (data: {
  sku: string;
  name: string;
  category: string;
  imageUrl?: string;
  calories?: number;
  proteinG?: number;
  carbsG?: number;
  fatG?: number;
  description?: string;
  mrp: number;
  sellingPrice: number;
  gstPercent: number;
  shelfLifeHours: number;
}) => {
  return prisma.product.create({ data });
};

export const createBatch = async (data: {
  batchCode: string;
  productId: string;
  manufacturedAt: string;
  expiresAt: string;
}) => {
  const product = await prisma.product.findUnique({ where: { id: data.productId } });
  if (!product) throw ApiError.notFound("Product not found", "PRODUCT_NOT_FOUND");

  return prisma.batch.create({
    data: {
      batchCode: data.batchCode,
      productId: data.productId,
      manufacturedAt: new Date(data.manufacturedAt),
      expiresAt: new Date(data.expiresAt),
    },
  });
};

export const createFridge = (data: {
  code: string;
  name: string;
  location?: string;
  companyId?: string;
}) => {
  return prisma.fridge.create({ data });
};

// Allocate (or top up) stock of a batch at a fridge — this is what
// kitchen staff do after restocking / servicing a fridge.
export const allocateStock = async (fridgeId: string, batchId: string, quantity: number) => {
  const fridge = await prisma.fridge.findUnique({ where: { id: fridgeId } });
  if (!fridge) throw ApiError.notFound("Fridge not found", "FRIDGE_NOT_FOUND");

  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) throw ApiError.notFound("Batch not found", "BATCH_NOT_FOUND");

  return prisma.fridgeStock.upsert({
    where: { fridgeId_batchId: { fridgeId, batchId } },
    update: { quantityAvailable: { increment: quantity } },
    create: { fridgeId, batchId, quantityAvailable: quantity },
  });
};

export const listFridgeStock = (fridgeId: string) => {
  return prisma.fridgeStock.findMany({
    where: { fridgeId },
    include: { batch: { include: { product: true } } },
  });
};

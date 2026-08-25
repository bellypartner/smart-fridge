import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";
import { buildBatchCode } from "../../utils/batchCode";

// ── Categories ───────────────────────────────────────────────
export const createCategory = async (name: string) => {
  const existing = await prisma.category.findUnique({ where: { name } });
  if (existing) throw ApiError.conflict("A category with this name already exists", "CATEGORY_EXISTS");
  return prisma.category.create({ data: { name } });
};

export const listCategories = () => {
  return prisma.category.findMany({ orderBy: { name: "asc" } });
};

// ── Products ─────────────────────────────────────────────────
export const createProduct = async (data: {
  sku: string;
  name: string;
  categoryId: string;
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
  const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
  if (!category) throw ApiError.notFound("Category not found", "CATEGORY_NOT_FOUND");

  return prisma.product.create({ data, include: { category: true } });
};

// ── Batches ──────────────────────────────────────────────────
// Creating a batch now does three things in one step: generates its code
// (SC-<fridge code>-<product code>-<YYMMDD>), computes its expiry from the
// product's shelf life, and allocates the given quantity to the chosen
// fridge — the admin no longer types a batch code or an expiry date by hand.
export const createBatch = async (data: {
  productId: string;
  fridgeId: string;
  manufacturedAt: string;
  quantity: number;
}) => {
  const product = await prisma.product.findUnique({ where: { id: data.productId } });
  if (!product) throw ApiError.notFound("Product not found", "PRODUCT_NOT_FOUND");

  const fridge = await prisma.fridge.findUnique({ where: { id: data.fridgeId } });
  if (!fridge) throw ApiError.notFound("Fridge not found", "FRIDGE_NOT_FOUND");

  const manufacturedAt = new Date(data.manufacturedAt);
  const expiresAt = new Date(manufacturedAt.getTime() + product.shelfLifeHours * 60 * 60 * 1000);

  // Resolve the rare collision (same fridge + product + day, batched twice)
  // by appending -2, -3, ... rather than failing the request outright.
  const baseCode = buildBatchCode(fridge.code, product.name, manufacturedAt);
  let batchCode = baseCode;
  let suffix = 2;
  while (await prisma.batch.findUnique({ where: { batchCode } })) {
    batchCode = `${baseCode}-${suffix}`;
    suffix += 1;
  }

  return prisma.$transaction(async (tx) => {
    const batch = await tx.batch.create({
      data: { batchCode, productId: data.productId, manufacturedAt, expiresAt },
      include: { product: true },
    });

    const stock = await tx.fridgeStock.upsert({
      where: { fridgeId_batchId: { fridgeId: data.fridgeId, batchId: batch.id } },
      update: { quantityAvailable: { increment: data.quantity } },
      create: { fridgeId: data.fridgeId, batchId: batch.id, quantityAvailable: data.quantity },
    });

    return { batch, stock };
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

// Allocate (or top up) stock of an existing batch at a fridge — for
// restocking a fridge with a batch that's already been created.
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

export const listFridges = () => {
  return prisma.fridge.findMany({ orderBy: { createdAt: "desc" } });
};

export const listProducts = () => {
  return prisma.product.findMany({
    include: { category: true },
    orderBy: { createdAt: "desc" },
  });
};

export const listBatches = () => {
  return prisma.batch.findMany({
    include: { product: { include: { category: true } } },
    orderBy: { createdAt: "desc" },
  });
};

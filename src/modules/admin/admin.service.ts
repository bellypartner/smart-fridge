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

export const updateCategory = async (id: string, name: string) => {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Category not found", "CATEGORY_NOT_FOUND");

  const clash = await prisma.category.findUnique({ where: { name } });
  if (clash && clash.id !== id) throw ApiError.conflict("A category with this name already exists", "CATEGORY_EXISTS");

  return prisma.category.update({ where: { id }, data: { name } });
};

export const deleteCategory = async (id: string) => {
  const existing = await prisma.category.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Category not found", "CATEGORY_NOT_FOUND");

  const productCount = await prisma.product.count({ where: { categoryId: id } });
  if (productCount > 0) {
    throw ApiError.conflict(
      `${productCount} product(s) use this category — move or delete them first`,
      "CATEGORY_IN_USE"
    );
  }

  await prisma.category.delete({ where: { id } });
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

export const updateProduct = async (
  id: string,
  data: Partial<{
    name: string;
    categoryId: string;
    imageUrl: string;
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    description: string;
    mrp: number;
    sellingPrice: number;
    gstPercent: number;
    shelfLifeHours: number;
    isActive: boolean;
  }>
) => {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Product not found", "PRODUCT_NOT_FOUND");

  if (data.categoryId) {
    const category = await prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!category) throw ApiError.notFound("Category not found", "CATEGORY_NOT_FOUND");
  }

  return prisma.product.update({ where: { id }, data, include: { category: true } });
};

export const deleteProduct = async (id: string) => {
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Product not found", "PRODUCT_NOT_FOUND");

  const batchCount = await prisma.batch.count({ where: { productId: id } });
  if (batchCount > 0) {
    throw ApiError.conflict(
      `${batchCount} batch(es) exist for this product — deactivate it instead of deleting, or remove those batches first`,
      "PRODUCT_IN_USE"
    );
  }

  await prisma.product.delete({ where: { id } });
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

export const updateBatchStatus = async (id: string, status: "ACTIVE" | "EXPIRED" | "RECALLED") => {
  const existing = await prisma.batch.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Batch not found", "BATCH_NOT_FOUND");
  return prisma.batch.update({ where: { id }, data: { status }, include: { product: true } });
};

export const deleteBatch = async (id: string) => {
  const existing = await prisma.batch.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Batch not found", "BATCH_NOT_FOUND");

  const soldCount = await prisma.orderItem.count({ where: { batchId: id } });
  if (soldCount > 0) {
    throw ApiError.conflict(
      "This batch has real order history and can't be deleted — mark it RECALLED instead",
      "BATCH_HAS_ORDERS"
    );
  }

  await prisma.$transaction([
    prisma.fridgeStock.deleteMany({ where: { batchId: id } }),
    prisma.cartItem.deleteMany({ where: { batchId: id } }),
    prisma.batch.delete({ where: { id } }),
  ]);
};

export const createFridge = (data: {
  code: string;
  name: string;
  location?: string;
  companyId?: string;
}) => {
  return prisma.fridge.create({ data });
};

export const updateFridge = async (
  id: string,
  data: Partial<{ name: string; location: string; isActive: boolean }>
) => {
  const existing = await prisma.fridge.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Fridge not found", "FRIDGE_NOT_FOUND");
  return prisma.fridge.update({ where: { id }, data });
};

export const deleteFridge = async (id: string) => {
  const existing = await prisma.fridge.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Fridge not found", "FRIDGE_NOT_FOUND");

  const [stockCount, sessionCount, orderCount] = await Promise.all([
    prisma.fridgeStock.count({ where: { fridgeId: id } }),
    prisma.shoppingSession.count({ where: { fridgeId: id } }),
    prisma.order.count({ where: { fridgeId: id } }),
  ]);

  if (stockCount > 0 || sessionCount > 0 || orderCount > 0) {
    throw ApiError.conflict(
      "This fridge has stock and/or order history and can't be deleted — deactivate it instead",
      "FRIDGE_IN_USE"
    );
  }

  await prisma.fridge.delete({ where: { id } });
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

// Sets the exact available quantity — for correcting a manual stock count
// (physical count vs. system count), unlike allocateStock() above which
// only ever adds to whatever's already there.
export const setStockQuantity = async (fridgeId: string, batchId: string, quantityAvailable: number) => {
  const stock = await prisma.fridgeStock.findUnique({ where: { fridgeId_batchId: { fridgeId, batchId } } });
  if (!stock) throw ApiError.notFound("Stock record not found", "STOCK_NOT_FOUND");
  return prisma.fridgeStock.update({
    where: { fridgeId_batchId: { fridgeId, batchId } },
    data: { quantityAvailable },
  });
};

export const deleteStock = async (fridgeId: string, batchId: string) => {
  const stock = await prisma.fridgeStock.findUnique({ where: { fridgeId_batchId: { fridgeId, batchId } } });
  if (!stock) throw ApiError.notFound("Stock record not found", "STOCK_NOT_FOUND");

  if (stock.quantityHeld > 0) {
    throw ApiError.conflict(
      "Someone currently has this item in an active cart — wait for their session to finish or expire first",
      "STOCK_HELD"
    );
  }

  await prisma.fridgeStock.delete({ where: { fridgeId_batchId: { fridgeId, batchId } } });
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

// ── Orders / Sales ───────────────────────────────────────────
export const listOrders = (filters: { status?: string; fridgeId?: string }) => {
  return prisma.order.findMany({
    where: {
      ...(filters.status ? { status: filters.status as never } : {}),
      ...(filters.fridgeId ? { fridgeId: filters.fridgeId } : {}),
    },
    include: { items: true, fridge: true },
    orderBy: { createdAt: "desc" },
    take: 200, // pilot scale — revisit with real pagination once order volume grows
  });
};

// Aggregated in application code rather than a DB groupBy — perfectly fine
// at pilot order volumes (hundreds, maybe low thousands), and keeps this
// readable. Worth moving to real SQL aggregation (or a cron-computed
// summary table) if order volume grows into the tens of thousands.
export const getSalesStats = async () => {
  const paidOrders = await prisma.order.findMany({
    where: { status: "PAID" },
    include: { items: true, fridge: true },
  });

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let totalRevenue = 0;
  let todayRevenue = 0;
  let todayOrders = 0;

  const productSales = new Map<string, { quantity: number; revenue: number }>();
  const fridgeSales = new Map<string, { orders: number; revenue: number }>();

  for (const order of paidOrders) {
    const amount = Number(order.totalAmount);
    totalRevenue += amount;

    if (order.paidAt && order.paidAt >= todayStart) {
      todayRevenue += amount;
      todayOrders += 1;
    }

    const fridgeName = order.fridge.name;
    const fridgeEntry = fridgeSales.get(fridgeName) ?? { orders: 0, revenue: 0 };
    fridgeEntry.orders += 1;
    fridgeEntry.revenue += amount;
    fridgeSales.set(fridgeName, fridgeEntry);

    for (const item of order.items) {
      const entry = productSales.get(item.productNameSnapshot) ?? { quantity: 0, revenue: 0 };
      entry.quantity += item.quantity;
      entry.revenue += Number(item.unitPrice) * item.quantity;
      productSales.set(item.productNameSnapshot, entry);
    }
  }

  const bestSellers = Array.from(productSales.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 8);

  const byFridge = Array.from(fridgeSales.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    totalRevenue,
    totalOrders: paidOrders.length,
    todayRevenue,
    todayOrders,
    bestSellers,
    byFridge,
  };
};

// ── Customers ────────────────────────────────────────────────
// There's no customer account (see order.service.ts) — phone number is the
// only stable identity we have, captured unverified at checkout. Grouping
// by phone rather than name since a name can be typed differently visit to
// visit, but the same phone is what actually identifies a repeat customer.
export const listCustomers = async () => {
  const paidOrders = await prisma.order.findMany({
    where: { status: "PAID" },
    orderBy: { paidAt: "asc" },
  });

  const byPhone = new Map<string, { name: string; dates: Date[]; totalSpent: number }>();

  for (const order of paidOrders) {
    const entry = byPhone.get(order.customerPhone) ?? { name: order.customerName, dates: [], totalSpent: 0 };
    entry.name = order.customerName; // last-seen name wins — orders are ascending by paidAt
    entry.dates.push(order.paidAt ?? order.createdAt);
    entry.totalSpent += Number(order.totalAmount);
    byPhone.set(order.customerPhone, entry);
  }

  const customers = Array.from(byPhone.entries()).map(([phone, entry]) => {
    const totalOrders = entry.dates.length;
    const firstOrderAt = entry.dates[0];
    const lastOrderAt = entry.dates[entry.dates.length - 1];

    let avgDaysBetweenOrders: number | null = null;
    if (totalOrders >= 2) {
      const spanMs = lastOrderAt.getTime() - firstOrderAt.getTime();
      avgDaysBetweenOrders = spanMs / (totalOrders - 1) / (1000 * 60 * 60 * 24);
    }

    let frequencyLabel: string;
    if (totalOrders === 1) frequencyLabel = "New";
    else if (avgDaysBetweenOrders !== null && avgDaysBetweenOrders <= 7) frequencyLabel = "Frequent";
    else if (avgDaysBetweenOrders !== null && avgDaysBetweenOrders <= 21) frequencyLabel = "Regular";
    else frequencyLabel = "Occasional";

    return {
      phone,
      name: entry.name,
      totalOrders,
      totalSpent: entry.totalSpent,
      firstOrderAt,
      lastOrderAt,
      avgDaysBetweenOrders,
      frequencyLabel,
    };
  });

  return customers.sort((a, b) => b.totalSpent - a.totalSpent);
};

export const getCustomerHistory = (phone: string) => {
  return prisma.order.findMany({
    where: { customerPhone: phone },
    include: { items: true, fridge: true },
    orderBy: { createdAt: "desc" },
  });
};

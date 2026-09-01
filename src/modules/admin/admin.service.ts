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
  weightGrams?: number;
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
    weightGrams: number;
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
// A batch is a production run, not a fridge assignment — it isn't tied
// to any one fridge. Creating one generates its code (<product
// code>-<DDMM>) and computes its expiry from the product's shelf life;
// totalQuantity records how much was made overall. Getting units into
// a specific fridge is a separate step — see allocateStock() below,
// which is capped against totalQuantity so you can't allocate out more
// than was actually produced.
export const createBatch = async (data: {
  productId: string;
  manufacturedAt: string;
  totalQuantity: number;
}) => {
  const product = await prisma.product.findUnique({ where: { id: data.productId } });
  if (!product) throw ApiError.notFound("Product not found", "PRODUCT_NOT_FOUND");

  const manufacturedAt = new Date(data.manufacturedAt);
  const expiresAt = new Date(manufacturedAt.getTime() + product.shelfLifeHours * 60 * 60 * 1000);

  // Resolve the rare collision (same product batched twice in one day)
  // by appending -2, -3, ... rather than failing the request outright.
  const baseCode = buildBatchCode(product.name, manufacturedAt);
  let batchCode = baseCode;
  let suffix = 2;
  while (await prisma.batch.findUnique({ where: { batchCode } })) {
    batchCode = `${baseCode}-${suffix}`;
    suffix += 1;
  }

  return prisma.batch.create({
    data: { batchCode, productId: data.productId, manufacturedAt, expiresAt, totalQuantity: data.totalQuantity },
    include: { product: true },
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

// Allocate (or top up) stock of an existing batch at a fridge — this is
// THE step that actually distributes a mass-produced batch out to
// specific fridges (batch creation itself no longer touches any fridge).
export const allocateStock = async (fridgeId: string, batchId: string, quantity: number) => {
  const fridge = await prisma.fridge.findUnique({ where: { id: fridgeId } });
  if (!fridge) throw ApiError.notFound("Fridge not found", "FRIDGE_NOT_FOUND");

  const batch = await prisma.batch.findUnique({ where: { id: batchId } });
  if (!batch) throw ApiError.notFound("Batch not found", "BATCH_NOT_FOUND");

  // Cap against how much was actually produced — but only when tracked;
  // batches from before totalQuantity existed have it as null and stay
  // uncapped for backward compatibility.
  if (batch.totalQuantity != null) {
    const allocatedSoFar = await prisma.fridgeStock.aggregate({
      where: { batchId },
      _sum: { quantityAllocated: true },
    });
    const alreadyAllocated = allocatedSoFar._sum.quantityAllocated ?? 0;
    const remaining = batch.totalQuantity - alreadyAllocated;
    if (quantity > remaining) {
      throw ApiError.conflict(
        `Only ${remaining} unit(s) of this batch are still unallocated (${alreadyAllocated} of ${batch.totalQuantity} already assigned to fridges)`,
        "EXCEEDS_BATCH_QUANTITY"
      );
    }
  }

  return prisma.fridgeStock.upsert({
    where: { fridgeId_batchId: { fridgeId, batchId } },
    update: { quantityAvailable: { increment: quantity }, quantityAllocated: { increment: quantity } },
    create: { fridgeId, batchId, quantityAvailable: quantity, quantityAllocated: quantity },
  });
};

export const listFridgeStock = (fridgeId: string) => {
  return prisma.fridgeStock.findMany({
    where: { fridgeId },
    include: { batch: { include: { product: true } } },
  });
};

// Sets exact values — for correcting a manual/physical count against what
// the system recorded, unlike allocateStock() above which only ever adds
// to whatever's already there. Deliberately does NOT touch
// quantityAllocated — this is a correction, not new stock coming in.
//
// quantityWasted is correctable here specifically for close-outs done
// remotely (e.g. from the office) before anyone has physically counted
// what's actually left at the fridge. If the real count turns out higher
// or lower once someone's physically there, fix it here — the number
// recorded at Close-out time is a best guess, not final, until it's been
// checked against reality.
export const setStockQuantity = async (
  fridgeId: string,
  batchId: string,
  data: { quantityAvailable?: number; quantityWasted?: number }
) => {
  const stock = await prisma.fridgeStock.findUnique({ where: { fridgeId_batchId: { fridgeId, batchId } } });
  if (!stock) throw ApiError.notFound("Stock record not found", "STOCK_NOT_FOUND");
  return prisma.fridgeStock.update({
    where: { fridgeId_batchId: { fridgeId, batchId } },
    data,
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

// The daily "close out" action for perishable stock: whatever's still sitting
// in quantityAvailable at close-out time is, by definition, getting thrown
// away — this records that as waste and zeroes it out so it can never be
// sold. Also flips the batch to EXPIRED (unless it's already RECALLED) so
// the Batches tab honestly reflects it's done for the day. Deliberately
// leaves quantityHeld alone — a cart still in flight resolves itself via the
// existing session-expiry/webhook paths, not this action.
export const closeOutStock = async (fridgeId: string, batchId: string) => {
  const stock = await prisma.fridgeStock.findUnique({ where: { fridgeId_batchId: { fridgeId, batchId } } });
  if (!stock) throw ApiError.notFound("Stock record not found", "STOCK_NOT_FOUND");

  const wastedNow = stock.quantityAvailable;

  return prisma.$transaction(async (tx) => {
    const updatedStock = await tx.fridgeStock.update({
      where: { fridgeId_batchId: { fridgeId, batchId } },
      data: { quantityAvailable: 0, quantityWasted: { increment: wastedNow } },
      include: { batch: { include: { product: true } } },
    });

    const batch = await tx.batch.findUnique({ where: { id: batchId } });
    if (batch && batch.status === "ACTIVE") {
      await tx.batch.update({ where: { id: batchId }, data: { status: "EXPIRED" } });
    }

    return { stock: updatedStock, wastedNow };
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

// Includes computed allocatedSoFar/remaining per batch (sum of
// FridgeStock.quantityAllocated across every fridge that batch has ever
// been assigned to) — this is what lets the Stock tab show "how much of
// this batch is still available to assign to a fridge."
export const listBatches = async () => {
  const batches = await prisma.batch.findMany({
    include: { product: { include: { category: true } }, stocks: { select: { quantityAllocated: true } } },
    orderBy: { createdAt: "desc" },
  });

  return batches.map(({ stocks, ...batch }) => {
    const allocatedSoFar = stocks.reduce((sum, s) => sum + s.quantityAllocated, 0);
    const remaining = batch.totalQuantity != null ? batch.totalQuantity - allocatedSoFar : null;
    return { ...batch, allocatedSoFar, remaining };
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

// Manual override for exactly one situation: Razorpay genuinely captured a
// payment, but the webhook never reached us (misconfigured secret, wrong
// URL, temporary outage, etc.) so the order is stuck at PENDING forever.
// This mirrors payment.service.ts's handlePaymentCaptured() so the stock
// conversion and audit trail stay consistent — the only difference is this
// one is triggered by an admin who has independently verified the payment
// in the Razorpay dashboard, not by Razorpay's own webhook.
export const markOrderPaidManually = async (
  orderId: string,
  actorId: string,
  razorpayPaymentId?: string
) => {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
  if (!order) throw ApiError.notFound("Order not found", "ORDER_NOT_FOUND");

  if (order.status === "PAID") {
    return order; // idempotent — already handled, nothing to do
  }
  if (order.status !== "PENDING") {
    throw ApiError.conflict(
      `This order is ${order.status}, not PENDING — only a stuck pending order can be marked paid this way`,
      "ORDER_NOT_PENDING"
    );
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        razorpayPaymentId: razorpayPaymentId ?? order.razorpayPaymentId,
        paidAt: new Date(),
      },
    });

    for (const item of order.items) {
      await tx.fridgeStock.updateMany({
        where: { fridgeId: order.fridgeId, batchId: item.batchId },
        data: {
          quantityAvailable: { decrement: item.quantity },
          quantityHeld: { decrement: item.quantity },
          quantitySold: { increment: item.quantity },
        },
      });
    }

    await tx.shoppingSession.update({
      where: { id: order.sessionId },
      data: { status: "CHECKED_OUT", closedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        actorId, // the admin who did this — unlike the webhook path, there IS a logged-in actor here
        action: "ORDER_MARKED_PAID_MANUALLY",
        entityType: "Order",
        entityId: order.id,
        metadata: { razorpayPaymentId: razorpayPaymentId ?? null, customerPhone: order.customerPhone },
      },
    });

    return updated;
  });
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

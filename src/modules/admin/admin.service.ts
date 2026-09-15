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
  volumeMl?: number;
  mrp: number;
  sellingPrice: number;
  costPrice?: number;
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
    volumeMl: number;
    mrp: number;
    sellingPrice: number;
    costPrice: number;
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
    data: {
      batchCode,
      productId: data.productId,
      manufacturedAt,
      expiresAt,
      totalQuantity: data.totalQuantity,
      costPricePerUnit: product.costPrice, // snapshot — null if the product has no cost set yet
    },
    include: { product: true },
  });
};

export const updateBatch = async (
  id: string,
  data: Partial<{ status: "ACTIVE" | "EXPIRED" | "RECALLED"; totalQuantity: number }>
) => {
  const existing = await prisma.batch.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Batch not found", "BATCH_NOT_FOUND");
  return prisma.batch.update({ where: { id }, data, include: { product: true } });
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

// A backup bank/UPI QR is posted at each fridge for when scan-and-pay is
// down — a customer takes the item and pays that directly. This records
// those units as a real sale (not waste): reduces FridgeStock the same
// way an actual Order would, snapshots the product's current selling
// price, and feeds into getProfitability() alongside Orders so Sales/COGS
// reflect it. Quantity can't exceed what's actually available — you can't
// manually sell more than what's physically sitting in the fridge.
export const recordManualSale = async (
  fridgeId: string,
  batchId: string,
  quantity: number,
  actorId: string,
  note?: string,
  channel: string = "bank_qr"
) => {
  const stock = await prisma.fridgeStock.findUnique({
    where: { fridgeId_batchId: { fridgeId, batchId } },
    include: { batch: { include: { product: true } } },
  });
  if (!stock) throw ApiError.notFound("Stock record not found", "STOCK_NOT_FOUND");
  if (quantity > stock.quantityAvailable) {
    throw ApiError.conflict(
      `Only ${stock.quantityAvailable} unit(s) are available at this fridge — can't record a sale for more than that`,
      "EXCEEDS_AVAILABLE"
    );
  }

  const unitPrice = stock.batch.product.sellingPrice;
  const totalAmount = unitPrice.mul(quantity);

  return prisma.$transaction(async (tx) => {
    await tx.fridgeStock.update({
      where: { fridgeId_batchId: { fridgeId, batchId } },
      data: { quantityAvailable: { decrement: quantity }, quantitySold: { increment: quantity } },
    });

    const sale = await tx.manualSale.create({
      data: { fridgeId, batchId, quantity, unitPrice, totalAmount, recordedBy: actorId, note, channel },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        action: channel === "vending_machine" ? "VENDING_SALE_RECORDED" : "MANUAL_SALE_RECORDED",
        entityType: "ManualSale",
        entityId: sale.id,
        metadata: { fridgeId, batchId, quantity, totalAmount: totalAmount.toString(), channel },
      },
    });

    return sale;
  });
};

export const listManualSales = (filters: { fridgeId?: string; channel?: string; from?: Date; to?: Date }) => {
  return prisma.manualSale.findMany({
    where: {
      ...(filters.fridgeId ? { fridgeId: filters.fridgeId } : {}),
      ...(filters.channel ? { channel: filters.channel } : {}),
      ...(filters.from && filters.to ? { recordedAt: { gte: filters.from, lte: filters.to } } : {}),
    },
    include: { batch: { include: { product: true } }, fridge: true },
    orderBy: { recordedAt: "desc" },
    take: 300,
  });
};

// Corrects the quantity on an already-recorded manual/vending sale — there
// was no way to fix a mistyped quantity before this, short of deleting and
// re-entering. Applies just the delta to FridgeStock (not the full
// quantity again), keeps the original snapshotted unitPrice (this is a
// quantity correction, not a re-sale at today's price), and recomputes
// totalAmount from it.
export const updateManualSale = async (id: string, newQuantity: number) => {
  const sale = await prisma.manualSale.findUnique({ where: { id }, include: { batch: true } });
  if (!sale) throw ApiError.notFound("Manual sale not found", "MANUAL_SALE_NOT_FOUND");

  const delta = newQuantity - sale.quantity;
  if (delta === 0) return sale;

  const stock = await prisma.fridgeStock.findUnique({
    where: { fridgeId_batchId: { fridgeId: sale.fridgeId, batchId: sale.batchId } },
  });
  if (!stock) throw ApiError.notFound("Stock record not found", "STOCK_NOT_FOUND");

  // Increasing the recorded quantity takes more units out of availability —
  // can't take more than what's actually still there.
  if (delta > 0 && delta > stock.quantityAvailable) {
    throw ApiError.conflict(
      `Only ${stock.quantityAvailable} more unit(s) are available — can't increase this sale by ${delta}`,
      "EXCEEDS_AVAILABLE"
    );
  }

  const newTotalAmount = sale.unitPrice.mul(newQuantity);

  return prisma.$transaction(async (tx) => {
    await tx.fridgeStock.update({
      where: { fridgeId_batchId: { fridgeId: sale.fridgeId, batchId: sale.batchId } },
      data: { quantityAvailable: { decrement: delta }, quantitySold: { increment: delta } },
    });

    const updated = await tx.manualSale.update({
      where: { id },
      data: { quantity: newQuantity, totalAmount: newTotalAmount },
    });

    await tx.auditLog.create({
      data: {
        action: "MANUAL_SALE_CORRECTED",
        entityType: "ManualSale",
        entityId: id,
        metadata: { previousQuantity: sale.quantity, newQuantity, delta },
      },
    });

    return updated;
  });
};

// Fully reverses a manual/vending sale — for when it was recorded in
// error entirely, not just with the wrong quantity (use updateManualSale
// for that). Gives every unit back to quantityAvailable and removes it
// from quantitySold before deleting the record.
export const deleteManualSale = async (id: string) => {
  const sale = await prisma.manualSale.findUnique({ where: { id } });
  if (!sale) throw ApiError.notFound("Manual sale not found", "MANUAL_SALE_NOT_FOUND");

  return prisma.$transaction(async (tx) => {
    await tx.fridgeStock.update({
      where: { fridgeId_batchId: { fridgeId: sale.fridgeId, batchId: sale.batchId } },
      data: { quantityAvailable: { increment: sale.quantity }, quantitySold: { decrement: sale.quantity } },
    });

    await tx.manualSale.delete({ where: { id } });

    await tx.auditLog.create({
      data: {
        action: "MANUAL_SALE_DELETED",
        entityType: "ManualSale",
        entityId: id,
        metadata: { quantity: sale.quantity, totalAmount: sale.totalAmount.toString() },
      },
    });
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

// Records a refund for reporting purposes — this does NOT call Razorpay's
// refund API to actually move money; process the real refund in Razorpay's
// dashboard first, then record it here so profitability reporting reflects
// it. Only a PAID order can be refunded (an order that was never
// successfully paid has nothing to refund), and the amount can't exceed
// what was actually paid.
export const recordRefund = async (orderId: string, actorId: string, refundAmount: number) => {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw ApiError.notFound("Order not found", "ORDER_NOT_FOUND");

  if (order.status !== "PAID") {
    throw ApiError.conflict(
      `This order is ${order.status}, not PAID — only a paid order can be refunded`,
      "ORDER_NOT_PAID"
    );
  }
  if (refundAmount > Number(order.totalAmount)) {
    throw ApiError.conflict(
      `Refund amount (₹${refundAmount}) can't exceed the order total (₹${order.totalAmount})`,
      "REFUND_EXCEEDS_TOTAL"
    );
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "REFUNDED", refundAmount, refundedAt: new Date() },
  });

  await prisma.auditLog.create({
    data: {
      actorId,
      action: "ORDER_REFUNDED",
      entityType: "Order",
      entityId: order.id,
      metadata: { refundAmount, customerPhone: order.customerPhone },
    },
  });

  return updated;
};

// ── Expenses ─────────────────────────────────────────────────
// Month-end operating costs — the layer between Gross Profit and Net
// Profit (see getProfitability below). Free-form: no predefined category
// list, just whatever the admin types.
export const createExpense = async (data: { description: string; category?: string; amount: number; incurredOn: string }) => {
  return prisma.expense.create({
    data: {
      description: data.description,
      category: data.category,
      amount: data.amount,
      incurredOn: new Date(data.incurredOn),
    },
  });
};

export const listExpenses = (filters: { from?: Date; to?: Date }) => {
  return prisma.expense.findMany({
    where: filters.from && filters.to ? { incurredOn: { gte: filters.from, lte: filters.to } } : undefined,
    orderBy: { incurredOn: "desc" },
  });
};

// Distinct categories ever used, for the dashboard's "pick existing or
// create new" dropdown — so a typo-prone free-text field doesn't quietly
// fragment "Rent" and "rent" into two categories in the breakdown.
export const listExpenseCategories = async () => {
  const rows = await prisma.expense.findMany({
    where: { category: { not: null } },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category).filter((c): c is string => c != null);
};

// Remembers a location name the first time it's used for a delivery or
// subscription feedback QR — upsert so generating the same location's QR
// again later doesn't error or duplicate.
export const recordQrLocation = async (type: string, location: string) => {
  return prisma.qrLocation.upsert({
    where: { type_location: { type, location } },
    update: {},
    create: { type, location },
  });
};

export const listQrLocations = (type: string) => {
  return prisma.qrLocation.findMany({
    where: { type },
    orderBy: { location: "asc" },
  });
};

export const deleteExpense = async (id: string) => {
  const existing = await prisma.expense.findUnique({ where: { id } });
  if (!existing) throw ApiError.notFound("Expense not found", "EXPENSE_NOT_FOUND");
  await prisma.expense.delete({ where: { id } });
};

// ── Profitability ────────────────────────────────────────────
// Gross Profit  = Sales − Refunds − COGS − Wastage cost
// Gross Margin% = Gross Profit ÷ Sales × 100
// Net Profit    = Gross Profit − Expenses (the month-end layer above)
//
// One-time catch-up for existing batches that predate a product ever
// having a cost price set — costPricePerUnit only ever gets snapshotted
// onto a batch at the moment it's CREATED (createBatch), so setting a
// cost price on a Product today does nothing for batches that already
// exist; they'd show up as "missing cost" in getProfitability forever
// otherwise. This fills that gap using each product's CURRENT cost
// price, once, for whatever's missing right now. It never overwrites a
// batch that already has costPricePerUnit set — that would rewrite a
// real historical snapshot, which is exactly what the snapshot design
// exists to prevent. Going forward, a weekly cost price change still
// only affects batches created after that change, same as always —
// this only ever closes the gap for batches that never got a snapshot
// in the first place.
export const backfillBatchCosts = async (actorId: string) => {
  const productsWithCost = await prisma.product.findMany({ where: { costPrice: { not: null } } });

  let updatedCount = 0;
  const perProduct: { productId: string; productName: string; updated: number }[] = [];

  for (const product of productsWithCost) {
    const result = await prisma.batch.updateMany({
      where: { productId: product.id, costPricePerUnit: null },
      data: { costPricePerUnit: product.costPrice },
    });
    if (result.count > 0) {
      updatedCount += result.count;
      perProduct.push({ productId: product.id, productName: product.name, updated: result.count });
    }
  }

  if (updatedCount > 0) {
    await prisma.auditLog.create({
      data: {
        actorId,
        action: "BATCH_COSTS_BACKFILLED",
        entityType: "Batch",
        entityId: "bulk",
        metadata: { updatedCount, perProduct },
      },
    });
  }

  return { updatedCount, perProduct };
};

// Sales and Refunds are both anchored to the order's paidAt — a sale and
// its later refund stay together in the same report period rather than
// splitting across two. Wastage is anchored to the batch's manufacturedAt
// instead of FridgeStock.updatedAt (which can be bumped by an unrelated
// later correction) — a batch is inherently one day's production, so its
// waste is treated as belonging to that same day.
//
// Any item/batch with no costPricePerUnit set is simply excluded from
// COGS/wastage cost rather than assumed to cost zero — itemsMissingCost
// and wastedUnitsMissingCost surface how many units that affected, so the
// number is never silently wrong, just visibly incomplete.
export const getProfitability = async (from: Date, to: Date) => {
  const orders = await prisma.order.findMany({
    where: { status: { in: ["PAID", "REFUNDED"] }, paidAt: { gte: from, lte: to } },
    include: { items: { include: { batch: true } } },
  });

  const appSales = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
  const refunds = orders.reduce((sum, o) => sum + Number(o.refundAmount ?? 0), 0);

  let cogs = 0;
  let itemsMissingCost = 0;
  for (const order of orders) {
    for (const item of order.items) {
      if (item.batch.costPricePerUnit != null) {
        cogs += Number(item.batch.costPricePerUnit) * item.quantity;
      } else {
        itemsMissingCost += item.quantity;
      }
    }
  }

  // Manual/vending sales — units sold outside the app (backup bank QR when
  // scan-and-pay was down, or a vending machine). Real revenue, so folded
  // into the same Sales/COGS totals as app orders, but tracked separately
  // by channel so each shows as its own line rather than one lump "manual"
  // figure that hides which channel it actually came from.
  const manualSales = await prisma.manualSale.findMany({
    where: { recordedAt: { gte: from, lte: to } },
    include: { batch: true },
  });
  let manualQrSalesTotal = 0;
  let vendingSalesTotal = 0;
  for (const sale of manualSales) {
    const amount = Number(sale.totalAmount);
    if (sale.channel === "vending_machine") vendingSalesTotal += amount;
    else manualQrSalesTotal += amount;

    if (sale.batch.costPricePerUnit != null) {
      cogs += Number(sale.batch.costPricePerUnit) * sale.quantity;
    } else {
      itemsMissingCost += sale.quantity;
    }
  }

  const sales = appSales + manualQrSalesTotal + vendingSalesTotal;

  const wastedStockRows = await prisma.fridgeStock.findMany({
    where: { quantityWasted: { gt: 0 }, batch: { manufacturedAt: { gte: from, lte: to } } },
    include: { batch: true },
  });
  let wastageCost = 0;
  let wastedUnitsMissingCost = 0;
  for (const row of wastedStockRows) {
    if (row.batch.costPricePerUnit != null) {
      wastageCost += Number(row.batch.costPricePerUnit) * row.quantityWasted;
    } else {
      wastedUnitsMissingCost += row.quantityWasted;
    }
  }

  const grossProfit = sales - refunds - cogs - wastageCost;
  const grossMarginPct = sales > 0 ? (grossProfit / sales) * 100 : null;

  const expenses = await prisma.expense.findMany({ where: { incurredOn: { gte: from, lte: to } } });
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
  const netProfit = grossProfit - totalExpenses;

  // Sub-total per category, so the statement shows what expenses actually
  // consist of rather than one opaque lump sum. Uncategorized expenses
  // (no category given) are grouped under that label rather than dropped.
  const expensesByCategoryMap = new Map<string, number>();
  for (const e of expenses) {
    const key = e.category || "Uncategorized";
    expensesByCategoryMap.set(key, (expensesByCategoryMap.get(key) ?? 0) + Number(e.amount));
  }
  const expensesByCategory = Array.from(expensesByCategoryMap.entries())
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    sales,
    appSales,
    manualQrSalesTotal,
    vendingSalesTotal,
    refunds,
    cogs,
    wastageCost,
    grossProfit,
    grossMarginPct,
    totalExpenses,
    expensesByCategory,
    netProfit,
    itemsMissingCost,
    wastedUnitsMissingCost,
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

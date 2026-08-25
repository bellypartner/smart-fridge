import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { ApiError } from "../../utils/apiError";

const SESSION_TTL_MS = env.SESSION_TTL_MINUTES * 60 * 1000;

// ── Create session (fires the moment the customer opens the app for a fridge) ─
export const createSession = async (fridgeCode: string) => {
  const fridge = await prisma.fridge.findUnique({ where: { code: fridgeCode } });
  if (!fridge || !fridge.isActive) {
    throw ApiError.notFound("Fridge not found or inactive", "FRIDGE_NOT_FOUND");
  }

  const session = await prisma.shoppingSession.create({
    data: {
      fridgeId: fridge.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  return session;
};

const getActiveSessionOrThrow = async (sessionId: string) => {
  const session = await prisma.shoppingSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    throw ApiError.notFound("Session not found", "SESSION_NOT_FOUND");
  }
  if (session.status !== "ACTIVE") {
    throw ApiError.gone(`Session is ${session.status.toLowerCase()}`, "SESSION_NOT_ACTIVE");
  }
  if (session.expiresAt < new Date()) {
    await expireSession(session.id);
    throw ApiError.gone("Session has expired", "SESSION_EXPIRED");
  }
  return session;
};

// ── Scan a batch QR → add/increment cart item, place a stock hold ─
export const scanBatch = async (sessionId: string, batchCode: string) => {
  const session = await getActiveSessionOrThrow(sessionId);

  return prisma.$transaction(async (tx) => {
    const batch = await tx.batch.findUnique({
      where: { batchCode },
      include: { product: true },
    });

    if (!batch || batch.status !== "ACTIVE") {
      throw ApiError.badRequest("This product code is not recognized", "BATCH_NOT_FOUND");
    }
    if (batch.expiresAt < new Date()) {
      throw ApiError.badRequest("This item has expired and cannot be sold", "BATCH_EXPIRED");
    }

    const stock = await tx.fridgeStock.findUnique({
      where: { fridgeId_batchId: { fridgeId: session.fridgeId, batchId: batch.id } },
    });

    // This is the check that rejects "product from another fridge" —
    // a batch only scans successfully at a fridge it has been allocated to.
    if (!stock) {
      throw ApiError.badRequest(
        "This item does not belong to this fridge",
        "BATCH_NOT_IN_FRIDGE"
      );
    }

    const availableToHold = stock.quantityAvailable - stock.quantityHeld;
    if (availableToHold < 1) {
      throw ApiError.conflict("This item is out of stock", "OUT_OF_STOCK");
    }

    await tx.fridgeStock.update({
      where: { id: stock.id },
      data: { quantityHeld: { increment: 1 } },
    });

    const cartItem = await tx.cartItem.upsert({
      where: { sessionId_batchId: { sessionId: session.id, batchId: batch.id } },
      update: { quantity: { increment: 1 } },
      create: {
        sessionId: session.id,
        batchId: batch.id,
        quantity: 1,
        unitPrice: batch.product.sellingPrice,
        gstPercent: batch.product.gstPercent,
      },
    });

    // scanning resets the inactivity clock
    await tx.shoppingSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });

    return { cartItem, product: batch.product };
  });
};

// ── Set (or zero-out) a cart item's quantity, adjusting the hold ──
export const updateCartItemQuantity = async (
  sessionId: string,
  itemId: string,
  quantity: number
) => {
  await getActiveSessionOrThrow(sessionId);

  return prisma.$transaction(async (tx) => {
    const item = await tx.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.sessionId !== sessionId) {
      throw ApiError.notFound("Cart item not found", "CART_ITEM_NOT_FOUND");
    }

    const session = await tx.shoppingSession.findUniqueOrThrow({ where: { id: sessionId } });
    const stock = await tx.fridgeStock.findUniqueOrThrow({
      where: { fridgeId_batchId: { fridgeId: session.fridgeId, batchId: item.batchId } },
    });

    const delta = quantity - item.quantity; // positive = holding more, negative = releasing

    if (delta > 0) {
      const availableToHold = stock.quantityAvailable - stock.quantityHeld;
      if (availableToHold < delta) {
        throw ApiError.conflict("Not enough stock available for that quantity", "OUT_OF_STOCK");
      }
    }

    await tx.fridgeStock.update({
      where: { id: stock.id },
      data: { quantityHeld: { increment: delta } },
    });

    if (quantity === 0) {
      await tx.cartItem.delete({ where: { id: itemId } });
      return null;
    }

    return tx.cartItem.update({ where: { id: itemId }, data: { quantity } });
  });
};

// ── Full cart snapshot with computed totals ─────────────────────
export const getCart = async (sessionId: string) => {
  const session = await getActiveSessionOrThrow(sessionId);

  const items = await prisma.cartItem.findMany({
    where: { sessionId: session.id },
    include: { batch: { include: { product: true } } },
    orderBy: { addedAt: "asc" },
  });

  let subtotal = new Prisma.Decimal(0);
  let gstAmount = new Prisma.Decimal(0);

  for (const item of items) {
    const lineSubtotal = item.unitPrice.mul(item.quantity);
    const lineGst = lineSubtotal.mul(item.gstPercent).div(100);
    subtotal = subtotal.add(lineSubtotal);
    gstAmount = gstAmount.add(lineGst);
  }

  return {
    session,
    items,
    subtotal,
    gstAmount,
    total: subtotal.add(gstAmount),
  };
};

// ── Expire a session and release any held stock back to the pool ─
export const expireSession = async (sessionId: string) => {
  return prisma.$transaction(async (tx) => {
    const session = await tx.shoppingSession.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== "ACTIVE") return;

    const items = await tx.cartItem.findMany({ where: { sessionId } });

    for (const item of items) {
      await tx.fridgeStock.updateMany({
        where: { fridgeId: session.fridgeId, batchId: item.batchId },
        data: { quantityHeld: { decrement: item.quantity } },
      });
    }

    await tx.shoppingSession.update({
      where: { id: sessionId },
      data: { status: "EXPIRED", closedAt: new Date() },
    });
  });
};

import { prisma } from "../../config/prisma";
import { razorpay } from "../../config/razorpay";
import { ApiError } from "../../utils/apiError";
import { getCart } from "../session/session.service";

// ── Checkout: freeze the cart into an Order + create a Razorpay order ─
// name/phone are mandatory here — there's no login, so this is the only
// identity captured on the order (unverified, for receipt/contact only).
export const checkout = async (sessionId: string, customerName: string, customerPhone: string) => {
  const { session, items, subtotal, gstAmount, total } = await getCart(sessionId);

  if (items.length === 0) {
    throw ApiError.badRequest("Cart is empty", "CART_EMPTY");
  }

  // one order per session, enforced by the unique constraint on Order.sessionId —
  // re-checking here just gives a cleaner error than a raw DB constraint failure
  const existingOrder = await prisma.order.findUnique({ where: { sessionId } });
  if (existingOrder) {
    if (existingOrder.status === "PENDING") return existingOrder;
    throw ApiError.conflict("This session already has a completed order", "ORDER_ALREADY_EXISTS");
  }

  const totalPaise = Math.round(Number(total) * 100);

  const razorpayOrder = await razorpay.orders.create({
    amount: totalPaise,
    currency: "INR",
    receipt: sessionId,
    notes: { sessionId, customerName, customerPhone, fridgeId: session.fridgeId },
  });

  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        sessionId,
        fridgeId: session.fridgeId,
        customerName,
        customerPhone,
        status: "PENDING",
        subtotal,
        gstAmount,
        totalAmount: total,
        razorpayOrderId: razorpayOrder.id,
        items: {
          create: items.map((item) => ({
            batchId: item.batchId,
            productNameSnapshot: item.batch.product.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            gstPercent: item.gstPercent,
          })),
        },
      },
      include: { items: true },
    });

    // lock the cart against further edits while payment is in flight
    await tx.shoppingSession.update({
      where: { id: sessionId },
      data: { status: "CHECKED_OUT" },
    });

    return created;
  });

  return { order, razorpayOrderId: razorpayOrder.id, razorpayKeyId: process.env.RAZORPAY_KEY_ID, amount: totalPaise };
};

// Open lookup by order id — there's no login/order-history, so the id itself
// (an unguessable cuid, handed to the customer right after payment) is the
// receipt "key". Anyone with the id can view it, same as an email receipt link.
export const getOrder = async (orderId: string) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { items: true, fridge: true },
  });
  if (!order) {
    throw ApiError.notFound("Order not found", "ORDER_NOT_FOUND");
  }
  return order;
};

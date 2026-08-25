import crypto from "crypto";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";

export const verifyWebhookSignature = (rawBody: Buffer, signature: string | undefined): boolean => {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  // constant-time compare
  return (
    expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  );
};

// ── payment.captured: the only event that finalizes an order ────
export const handlePaymentCaptured = async (razorpayOrderId: string, razorpayPaymentId: string) => {
  const order = await prisma.order.findUnique({
    where: { razorpayOrderId },
    include: { items: true },
  });

  if (!order) {
    // Log and ack anyway — Razorpay retries on non-2xx, and we don't want
    // retry storms for an order that will never exist on our side.
    // eslint-disable-next-line no-console
    console.error(`Webhook for unknown razorpayOrderId: ${razorpayOrderId}`);
    return;
  }

  if (order.status === "PAID") {
    return; // idempotent — webhook can be delivered more than once
  }

  if (order.status !== "PENDING") {
    // eslint-disable-next-line no-console
    console.error(`payment.captured for order ${order.id} in unexpected status ${order.status}`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "PAID",
        razorpayPaymentId,
        paidAt: new Date(),
      },
    });

    // convert each item's stock hold into a confirmed sale
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
        actorId: null, // no logged-in actor — this was a customer, not staff
        action: "ORDER_PAID",
        entityType: "Order",
        entityId: order.id,
        metadata: { razorpayOrderId, razorpayPaymentId, customerPhone: order.customerPhone },
      },
    });
  });
};

export const handlePaymentFailed = async (razorpayOrderId: string) => {
  const order = await prisma.order.findUnique({ where: { razorpayOrderId }, include: { items: true } });
  if (!order || order.status !== "PENDING") return;

  await prisma.$transaction(async (tx) => {
    await tx.order.update({ where: { id: order.id }, data: { status: "FAILED" } });

    // release the stock holds — customer can retry from the same cart
    for (const item of order.items) {
      await tx.fridgeStock.updateMany({
        where: { fridgeId: order.fridgeId, batchId: item.batchId },
        data: { quantityHeld: { decrement: item.quantity } },
      });
    }

    await tx.shoppingSession.update({
      where: { id: order.sessionId },
      data: { status: "ACTIVE" }, // re-open the cart for retry
    });
  });
};


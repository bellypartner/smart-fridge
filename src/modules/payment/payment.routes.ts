import { Router, Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { ApiError } from "../../utils/apiError";
import * as paymentService from "./payment.service";

const router = Router();

// NOTE: this route is mounted in app.ts with express.raw() BEFORE the
// global express.json() middleware — Razorpay signature verification
// requires the exact raw request bytes, not a re-serialized JSON body.
router.post(
  "/webhook",
  asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers["x-razorpay-signature"] as string | undefined;
    const rawBody = req.body as Buffer;

    if (!paymentService.verifyWebhookSignature(rawBody, signature)) {
      throw ApiError.unauthorized("Invalid webhook signature", "INVALID_SIGNATURE");
    }

    const payload = JSON.parse(rawBody.toString("utf-8"));
    const event = payload.event as string;

    if (event === "payment.captured") {
      const paymentEntity = payload.payload.payment.entity;
      await paymentService.handlePaymentCaptured(paymentEntity.order_id, paymentEntity.id);
    } else if (event === "payment.failed") {
      const paymentEntity = payload.payload.payment.entity;
      await paymentService.handlePaymentFailed(paymentEntity.order_id);
    }
    // other events are acknowledged but ignored for Phase 1

    // Razorpay only cares about the 2xx — always ack quickly once verified
    res.status(200).json({ received: true });
  })
);

export default router;

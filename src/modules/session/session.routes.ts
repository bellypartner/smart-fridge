import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import {
  createSessionSchema,
  scanBatchSchema,
  sessionIdParamSchema,
  updateCartItemSchema,
} from "./session.schema";
import { checkoutSchema } from "../order/order.schema";
import * as sessionController from "./session.controller";
import * as orderController from "../order/order.controller";

const router = Router();

// No auth on this router — customers don't log in. The session id returned
// by POST / is the only thing needed to keep scanning into the same cart;
// it's a long random cuid, held client-side (localStorage), never guessable.

router.post("/", validate(createSessionSchema), asyncHandler(sessionController.createSession));
router.get("/:sessionId/cart", validate(sessionIdParamSchema), asyncHandler(sessionController.getCart));
router.post("/:sessionId/scan", validate(scanBatchSchema), asyncHandler(sessionController.scanBatch));
router.patch(
  "/:sessionId/cart/:itemId",
  validate(updateCartItemSchema),
  asyncHandler(sessionController.updateCartItem)
);
router.post(
  "/:sessionId/checkout",
  validate(checkoutSchema),
  asyncHandler(orderController.checkout)
);

export default router;

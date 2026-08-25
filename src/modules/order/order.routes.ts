import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import { orderIdParamSchema } from "./order.schema";
import * as orderController from "./order.controller";

const router = Router();

// No auth — order id itself (an unguessable cuid) is the receipt key,
// handed to the customer right after payment succeeds.
router.get("/:orderId", validate(orderIdParamSchema), asyncHandler(orderController.getOrder));

export default router;

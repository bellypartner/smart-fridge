import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { feedbackLimiter } from "../../middleware/rateLimit";
import {
  createDeliveryFeedbackSchema,
  createFeedbackSchema,
  createSubscriptionFeedbackSchema,
  listFeedbackQuerySchema,
} from "./feedback.schema";
import * as feedbackController from "./feedback.controller";

const router = Router();

// Public — no auth. Name is mandatory; everything else is optional.
router.post(
  "/",
  feedbackLimiter,
  validate(createFeedbackSchema),
  asyncHandler(feedbackController.createFeedback)
);

export default router;

// Public — Swiggy/Zomato order feedback. Same questions as fridge
// feedback, mounted separately under /api/feedback-delivery. Phone is
// mandatory here (see feedback.schema.ts).
export const deliveryFeedbackRouter = Router();
deliveryFeedbackRouter.post(
  "/",
  feedbackLimiter,
  validate(createDeliveryFeedbackSchema),
  asyncHandler(feedbackController.createDeliveryFeedback)
);

// Public — subscription feedback, mounted separately under /api/subscription-feedback
export const subscriptionFeedbackRouter = Router();
subscriptionFeedbackRouter.post(
  "/",
  feedbackLimiter,
  validate(createSubscriptionFeedbackSchema),
  asyncHandler(feedbackController.createSubscriptionFeedback)
);

// ── Feedback viewing — ADMIN and KITCHEN can both see ratings/reports;
// generating a location-scoped QR (POST /admin/qr-locations, in
// admin.routes.ts) stays ADMIN-only — see comment there. ──
export const adminFeedbackRouter = Router();
adminFeedbackRouter.use(requireAuth);

adminFeedbackRouter.get(
  "/",
  requireRole("ADMIN", "KITCHEN"),
  validate(listFeedbackQuerySchema),
  asyncHandler(feedbackController.listFeedback)
);

adminFeedbackRouter.get(
  "/stats",
  requireRole("ADMIN", "KITCHEN"),
  validate(listFeedbackQuerySchema),
  asyncHandler(feedbackController.getFeedbackStats)
);

// ── Subscription feedback viewing — same ADMIN+KITCHEN access as above ──
export const adminSubscriptionFeedbackRouter = Router();
adminSubscriptionFeedbackRouter.use(requireAuth);

adminSubscriptionFeedbackRouter.get(
  "/",
  requireRole("ADMIN", "KITCHEN"),
  asyncHandler(feedbackController.listSubscriptionFeedback)
);

adminSubscriptionFeedbackRouter.get(
  "/stats",
  requireRole("ADMIN", "KITCHEN"),
  asyncHandler(feedbackController.getSubscriptionFeedbackStats)
);

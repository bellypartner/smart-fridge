import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { feedbackLimiter } from "../../middleware/rateLimit";
import {
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

// Public — subscription feedback, mounted separately under /api/subscription-feedback
export const subscriptionFeedbackRouter = Router();
subscriptionFeedbackRouter.post(
  "/",
  feedbackLimiter,
  validate(createSubscriptionFeedbackSchema),
  asyncHandler(feedbackController.createSubscriptionFeedback)
);

// ── Admin-only viewing — mounted separately under /api/admin/feedback ──
export const adminFeedbackRouter = Router();
adminFeedbackRouter.use(requireAuth);

adminFeedbackRouter.get(
  "/",
  requireRole("ADMIN"),
  validate(listFeedbackQuerySchema),
  asyncHandler(feedbackController.listFeedback)
);

adminFeedbackRouter.get(
  "/stats",
  requireRole("ADMIN"),
  asyncHandler(feedbackController.getFeedbackStats)
);

// ── Admin-only viewing for subscription feedback — mounted under
// /api/admin/subscription-feedback ──
export const adminSubscriptionFeedbackRouter = Router();
adminSubscriptionFeedbackRouter.use(requireAuth);

adminSubscriptionFeedbackRouter.get(
  "/",
  requireRole("ADMIN"),
  asyncHandler(feedbackController.listSubscriptionFeedback)
);

adminSubscriptionFeedbackRouter.get(
  "/stats",
  requireRole("ADMIN"),
  asyncHandler(feedbackController.getSubscriptionFeedbackStats)
);

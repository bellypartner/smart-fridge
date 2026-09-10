import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { feedbackLimiter } from "../../middleware/rateLimit";
import { createFeedbackSchema, listFeedbackQuerySchema } from "./feedback.schema";
import * as feedbackController from "./feedback.controller";

const router = Router();

// Public — no auth. Anyone with the QR can submit; nothing is required.
router.post(
  "/",
  feedbackLimiter,
  validate(createFeedbackSchema),
  asyncHandler(feedbackController.createFeedback)
);

export default router;

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

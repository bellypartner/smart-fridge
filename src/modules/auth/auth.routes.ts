import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { otpRequestLimiter, otpVerifyLimiter } from "../../middleware/rateLimit";
import {
  bootstrapAdminSchema,
  createStaffSchema,
  loginSchema,
  refreshSchema,
  requestOtpSchema,
  updateStaffSchema,
  verifyOtpSchema,
} from "./auth.schema";
import * as authController from "./auth.controller";

const router = Router();

// Primary staff login now — password-based, no SMS dependency.
router.post("/login", validate(loginSchema), asyncHandler(authController.login));

// One-time use: creates the first ADMIN account. Gated by ADMIN_BOOTSTRAP_SECRET
// and refuses to run again once any ADMIN exists — see auth.service.ts.
router.post("/bootstrap-admin", validate(bootstrapAdminSchema), asyncHandler(authController.bootstrapAdmin));

// Admin-only: add, list, and manage staff accounts once the first admin exists.
router.post(
  "/staff",
  requireAuth,
  requireRole("ADMIN"),
  validate(createStaffSchema),
  asyncHandler(authController.createStaff)
);

router.get(
  "/staff",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(authController.listStaff)
);

router.patch(
  "/staff/:id",
  requireAuth,
  requireRole("ADMIN"),
  validate(updateStaffSchema),
  asyncHandler(authController.updateStaff)
);

router.post("/refresh", validate(refreshSchema), asyncHandler(authController.refresh));
router.post("/logout", validate(refreshSchema), asyncHandler(authController.logout));

// OTP endpoints kept for when a real SMS provider is wired up — unused for now.
router.post("/otp/request", otpRequestLimiter, validate(requestOtpSchema), asyncHandler(authController.requestOtp));
router.post("/otp/verify", otpVerifyLimiter, validate(verifyOtpSchema), asyncHandler(authController.verifyOtp));

export default router;

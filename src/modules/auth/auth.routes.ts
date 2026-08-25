import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { validate } from "../../middleware/validate";
import { otpRequestLimiter, otpVerifyLimiter } from "../../middleware/rateLimit";
import { refreshSchema, requestOtpSchema, verifyOtpSchema } from "./auth.schema";
import * as authController from "./auth.controller";

const router = Router();

router.post("/otp/request", otpRequestLimiter, validate(requestOtpSchema), asyncHandler(authController.requestOtp));
router.post("/otp/verify", otpVerifyLimiter, validate(verifyOtpSchema), asyncHandler(authController.verifyOtp));
router.post("/refresh", validate(refreshSchema), asyncHandler(authController.refresh));
router.post("/logout", validate(refreshSchema), asyncHandler(authController.logout));

export default router;

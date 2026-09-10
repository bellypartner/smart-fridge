import rateLimit from "express-rate-limit";

// General API traffic
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP request is the most abuse-prone endpoint (SMS cost) — keep it tight
export const otpRequestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many OTP requests. Try again shortly." } },
});

export const otpVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// Feedback is fully public/unauthenticated — this exists purely to stop a
// spam flood, not to constrain a genuine customer (nobody legitimately
// submits feedback more than a few times a minute).
export const feedbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many submissions. Try again in a minute." } },
});

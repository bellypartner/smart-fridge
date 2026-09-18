import express from "express";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import cookieParser from "cookie-parser";
import { env } from "./config/env";
import { apiLimiter } from "./middleware/rateLimit";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";

import authRoutes from "./modules/auth/auth.routes";
import fridgeRoutes from "./modules/fridge/fridge.routes";
import sessionRoutes from "./modules/session/session.routes";
import orderRoutes from "./modules/order/order.routes";
import paymentRoutes from "./modules/payment/payment.routes";
import adminRoutes from "./modules/admin/admin.routes";
import feedbackRoutes, {
  adminFeedbackRouter,
  adminSubscriptionFeedbackRouter,
  deliveryFeedbackRouter,
  subscriptionFeedbackRouter,
} from "./modules/feedback/feedback.routes";

export const app = express();

app.set("trust proxy", 1); // Railway sits behind a proxy — needed for correct req.ip / rate limiting

// CSP off: both the admin dashboard and the customer PWA are static files
// with inline script/style, a Google Fonts import, and (for the PWA) the
// html5-qrcode and Razorpay Checkout CDN scripts — the trade-off is fine
// here. Helmet's other protections (frame options, etc.) stay on.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  cors({
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
    credentials: true,
  })
);
app.use(compression());
app.use(cookieParser());

// Razorpay webhook needs the raw request body to verify the HMAC signature —
// mount it BEFORE express.json() so the body is never re-serialized.
app.use("/api/payments", express.raw({ type: "application/json" }), paymentRoutes);

app.use(express.json({ limit: "4mb" })); // headroom for base64 product images from the admin dashboard
app.use(apiLimiter);

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

// Public home page — pos.saladcaffe.com root. Choose location → choose
// fridge → straight into /shop for that fridge. Mounted at the bare root,
// which was otherwise unused.
app.use("/", express.static(path.join(process.cwd(), "public/home")));

// Admin dashboard — plain static HTML/JS, calls the /api routes below itself.
app.use("/admin", express.static(path.join(process.cwd(), "public/admin")));

// Customer-facing PWA — scan, cart, checkout. No auth, calls /api itself.
app.use("/shop", express.static(path.join(process.cwd(), "public/shop")));

// Feedback form — public, no auth, no cart. Separate from /shop since it
// has nothing to do with an active purchase.
app.use("/feedback", express.static(path.join(process.cwd(), "public/feedback")));

// Subscription feedback — separate audience/question set from fridge
// feedback above (a subscription customer isn't scanning anything, they'd
// get this link directly, e.g. over WhatsApp).
app.use("/subscription-feedback", express.static(path.join(process.cwd(), "public/subscription-feedback")));

// Swiggy/Zomato order feedback — same questions as fridge feedback, sent
// as a link since there's no QR to scan for a delivery-platform order.
app.use("/feedback-delivery", express.static(path.join(process.cwd(), "public/feedback-delivery")));

app.use("/api/auth", authRoutes);
app.use("/api/fridges", fridgeRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin/feedback", adminFeedbackRouter);
app.use("/api/admin/subscription-feedback", adminSubscriptionFeedbackRouter);
app.use("/api/admin", adminRoutes);
app.use("/api/feedback", feedbackRoutes);
app.use("/api/feedback-delivery", deliveryFeedbackRouter);
app.use("/api/subscription-feedback", subscriptionFeedbackRouter);

app.use(notFoundHandler);
app.use(errorHandler);

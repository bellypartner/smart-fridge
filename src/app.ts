import express from "express";
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

export const app = express();

app.set("trust proxy", 1); // Railway sits behind a proxy — needed for correct req.ip / rate limiting

app.use(helmet());
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

app.use(express.json({ limit: "1mb" }));
app.use(apiLimiter);

app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

app.use("/api/auth", authRoutes);
app.use("/api/fridges", fridgeRoutes);
app.use("/api/sessions", sessionRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/admin", adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

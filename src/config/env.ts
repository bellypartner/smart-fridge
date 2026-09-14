import { z } from "zod";
import "dotenv/config";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 chars"),
  JWT_REFRESH_SECRET: z.string().min(16, "JWT_REFRESH_SECRET must be at least 16 chars"),
  JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("30d"),

  OTP_EXPIRES_IN_MINUTES: z.coerce.number().default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),

  // Renamed from SESSION_TTL_MINUTES — a scanned-but-abandoned item was
  // staying "held" (unavailable to the next customer) for up to 10
  // minutes, which was long enough to be a real problem when someone
  // scanned an item, decided against it, and put it back within
  // moments. 45s is short enough to release quickly but long enough
  // that comparing two items or reading nutrition info before deciding
  // doesn't release your own held item out from under you while you're
  // still actively shopping. A completed checkout is unaffected by
  // this value regardless of how short it is — see session.sweeper.ts.
  SESSION_TTL_SECONDS: z.coerce.number().default(45),

  // One-time secret to create the very first ADMIN account via
  // POST /api/auth/bootstrap-admin. Set this in Railway, use it once, then
  // you can optionally remove it — the endpoint refuses to run a second
  // time once any ADMIN exists, regardless of this value.
  ADMIN_BOOTSTRAP_SECRET: z.string().min(16, "ADMIN_BOOTSTRAP_SECRET must be at least 16 chars"),

  RAZORPAY_KEY_ID: z.string().min(1, "RAZORPAY_KEY_ID is required"),
  RAZORPAY_KEY_SECRET: z.string().min(1, "RAZORPAY_KEY_SECRET is required"),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1, "RAZORPAY_WEBHOOK_SECRET is required"),

  CORS_ORIGIN: z.string().default("*"),

  SMS_PROVIDER_API_KEY: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";

import { z } from "zod";

const phoneSchema = z
  .string()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number");

export const requestOtpSchema = z.object({
  body: z.object({
    phone: phoneSchema,
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const verifyOtpSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    code: z.string().length(6, "OTP must be 6 digits"),
    name: z.string().min(1).max(80).optional(), // for first-time signup
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(10),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export const loginSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    password: z.string().min(1, "Password is required"),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const bootstrapAdminSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    password: passwordSchema,
    name: z.string().min(1).max(80),
    secret: z.string().min(1, "secret is required"),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const createStaffSchema = z.object({
  body: z.object({
    phone: phoneSchema,
    password: passwordSchema,
    name: z.string().min(1).max(80),
    role: z.enum(["ADMIN", "KITCHEN"]),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

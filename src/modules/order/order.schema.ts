import { z } from "zod";

const phoneSchema = z
  .string()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number");

export const checkoutSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, "Name is required").max(80),
    phone: phoneSchema,
  }),
  params: z.object({ sessionId: z.string().min(1) }),
  query: z.object({}).optional(),
});

export const orderIdParamSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ orderId: z.string().min(1) }),
  query: z.object({}).optional(),
});

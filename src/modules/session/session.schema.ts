import { z } from "zod";

export const createSessionSchema = z.object({
  body: z.object({
    fridgeCode: z.string().min(1),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const scanBatchSchema = z.object({
  body: z.object({
    batchCode: z.string().min(1),
  }),
  params: z.object({ sessionId: z.string().min(1) }),
  query: z.object({}).optional(),
});

export const updateCartItemSchema = z.object({
  body: z.object({
    quantity: z.number().int().min(0).max(50),
  }),
  params: z.object({ sessionId: z.string().min(1), itemId: z.string().min(1) }),
  query: z.object({}).optional(),
});

export const sessionIdParamSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ sessionId: z.string().min(1) }),
  query: z.object({}).optional(),
});

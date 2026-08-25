import { z } from "zod";

export const createProductSchema = z.object({
  body: z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    category: z.string().min(1),
    imageUrl: z.string().url().optional(),
    calories: z.number().int().optional(),
    proteinG: z.number().optional(),
    carbsG: z.number().optional(),
    fatG: z.number().optional(),
    description: z.string().optional(),
    mrp: z.number().positive(),
    sellingPrice: z.number().positive(),
    gstPercent: z.number().min(0).max(28).default(0),
    shelfLifeHours: z.number().int().positive(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const createBatchSchema = z.object({
  body: z.object({
    batchCode: z.string().min(1),
    productId: z.string().min(1),
    manufacturedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const createFridgeSchema = z.object({
  body: z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    location: z.string().optional(),
    companyId: z.string().optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const allocateStockSchema = z.object({
  body: z.object({
    batchId: z.string().min(1),
    quantity: z.number().int().positive(),
  }),
  params: z.object({ fridgeId: z.string().min(1) }),
  query: z.object({}).optional(),
});

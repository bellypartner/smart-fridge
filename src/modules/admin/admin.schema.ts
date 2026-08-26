import { z } from "zod";

export const listOrdersQuerySchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    status: z.enum(["PENDING", "PAID", "FAILED", "REFUNDED", "EXPIRED"]).optional(),
    fridgeId: z.string().optional(),
  }),
});

export const createCategorySchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(60),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const createProductSchema = z.object({
  body: z.object({
    sku: z.string().min(1),
    name: z.string().min(1),
    categoryId: z.string().min(1),
    // A base64 data URI from the dashboard's file input, not an external link —
    // kept as a loose string rather than z.string().url() for that reason.
    imageUrl: z.string().min(1).optional(),
    calories: z.number().int().optional(),
    proteinG: z.number().optional(),
    carbsG: z.number().optional(),
    fatG: z.number().optional(),
    description: z.string().optional(),
    weightGrams: z.number().int().positive().optional(),
    mrp: z.number().positive(),
    sellingPrice: z.number().positive(),
    gstPercent: z.number().min(0).max(28).default(0),
    shelfLifeHours: z.number().int().positive(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

// batchCode and expiresAt are no longer supplied by the admin — the server
// derives both (code from fridge+product+date, expiry from the product's
// shelf life) so the format is consistent and never mistyped. Creating a
// batch also allocates its initial stock to the chosen fridge in one step.
export const createBatchSchema = z.object({
  body: z.object({
    productId: z.string().min(1),
    fridgeId: z.string().min(1),
    manufacturedAt: z.string().datetime(),
    quantity: z.number().int().positive(),
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

// ── Update / delete schemas ──────────────────────────────────
const idParam = z.object({ id: z.string().min(1) });

export const updateCategorySchema = z.object({
  body: z.object({ name: z.string().trim().min(1).max(60) }),
  params: idParam,
  query: z.object({}).optional(),
});

export const idParamSchema = z.object({
  body: z.object({}).optional(),
  params: idParam,
  query: z.object({}).optional(),
});

export const updateProductSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    categoryId: z.string().min(1).optional(),
    imageUrl: z.string().min(1).optional(),
    calories: z.number().int().optional(),
    proteinG: z.number().optional(),
    carbsG: z.number().optional(),
    fatG: z.number().optional(),
    description: z.string().optional(),
    weightGrams: z.number().int().positive().optional(),
    mrp: z.number().positive().optional(),
    sellingPrice: z.number().positive().optional(),
    gstPercent: z.number().min(0).max(28).optional(),
    shelfLifeHours: z.number().int().positive().optional(),
    isActive: z.boolean().optional(),
  }),
  params: idParam,
  query: z.object({}).optional(),
});

export const updateFridgeSchema = z.object({
  body: z.object({
    name: z.string().min(1).optional(),
    location: z.string().optional(),
    isActive: z.boolean().optional(),
  }),
  params: idParam,
  query: z.object({}).optional(),
});

export const updateBatchStatusSchema = z.object({
  body: z.object({
    status: z.enum(["ACTIVE", "EXPIRED", "RECALLED"]),
  }),
  params: idParam,
  query: z.object({}).optional(),
});

export const updateStockSchema = z.object({
  body: z.object({
    quantityAvailable: z.number().int().min(0),
  }),
  params: z.object({ fridgeId: z.string().min(1), batchId: z.string().min(1) }),
  query: z.object({}).optional(),
});

export const stockParamSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ fridgeId: z.string().min(1), batchId: z.string().min(1) }),
  query: z.object({}).optional(),
});

export const customerPhoneParamSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({ phone: z.string().min(1) }),
  query: z.object({}).optional(),
});

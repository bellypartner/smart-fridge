import { z } from "zod";

const rating = z.number().int().min(1).max(5).optional();

export const createFeedbackSchema = z.object({
  body: z.object({
    name: z.string().trim().max(80).optional(),
    fridgeCode: z.string().min(1).optional(), // which fridge's QR this came from, if any

    tasteRating: rating,
    quantityRating: rating,
    qualityRating: rating,
    recommendRating: rating,
    foodSuggestion: z.string().trim().max(1000).optional(),

    serviceRating: rating,
    serviceComment: z.string().trim().max(1000).optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const listFeedbackQuerySchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({
    fridgeId: z.string().optional(),
  }),
});

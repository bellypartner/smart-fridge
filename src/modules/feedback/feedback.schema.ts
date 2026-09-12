import { z } from "zod";

const rating = z.number().int().min(1).max(5).optional();
// Loose on purpose — this is a callback number a customer volunteers, not
// a login credential. Rejecting it over minor formatting would just lose
// a genuine phone number to a strict regex.
const looseOptionalPhone = z.string().trim().max(20).optional();
const looseRequiredPhone = z.string().trim().min(1, "Phone number is required").max(20);

export const createFeedbackSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, "Name is required").max(80),
    phone: looseOptionalPhone,
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

// Same question set as fridge feedback above — Swiggy/Zomato orders have
// no fridge to scan, and the one real difference is phone is mandatory
// here (a delivery-platform customer is worth following up with; a
// walk-up fridge customer generally isn't as reachable/relevant).
export const createDeliveryFeedbackSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, "Name is required").max(80),
    phone: looseRequiredPhone,
    location: z.string().trim().max(120).optional(), // which kitchen/location this QR was scoped to

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
    source: z.enum(["fridge", "swiggy_zomato"]).optional(),
  }),
});

export const createSubscriptionFeedbackSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, "Name is required").max(80),
    phone: looseOptionalPhone,
    location: z.string().trim().max(120).optional(),

    satisfactionRating: rating,
    onTimeDeliveryRating: rating,
    goalsResultRating: rating,
    foodQualityRating: rating,
    quantityRating: rating,
    packagingRating: rating,
    recommendRating: rating,

    suggestions: z.string().trim().max(1000).optional(),
    additionalRequest: z.string().trim().max(1000).optional(),
    favoriteMeals: z.string().trim().max(1000).optional(),
  }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

import { prisma } from "../../config/prisma";

export const createFeedback = async (data: {
  name: string;
  phone?: string;
  fridgeCode?: string;
  source?: string; // "fridge" (default) | "swiggy_zomato"
  tasteRating?: number;
  quantityRating?: number;
  qualityRating?: number;
  recommendRating?: number;
  foodSuggestion?: string;
  serviceRating?: number;
  serviceComment?: string;
}) => {
  // Resolve the fridge code to an id if given, but never reject the
  // submission over a bad/stale code — feedback is more valuable than
  // strict validation here, so an unresolvable code just means no fridge
  // context gets attached, not a failed submission.
  let fridgeId: string | undefined;
  if (data.fridgeCode) {
    const fridge = await prisma.fridge.findUnique({ where: { code: data.fridgeCode } });
    fridgeId = fridge?.id;
  }

  return prisma.feedback.create({
    data: {
      name: data.name,
      phone: data.phone || undefined,
      source: data.source || "fridge",
      fridgeId,
      tasteRating: data.tasteRating,
      quantityRating: data.quantityRating,
      qualityRating: data.qualityRating,
      recommendRating: data.recommendRating,
      foodSuggestion: data.foodSuggestion || undefined,
      serviceRating: data.serviceRating,
      serviceComment: data.serviceComment || undefined,
    },
  });
};

export const listFeedback = (filters: { fridgeId?: string; source?: string }) => {
  const where: { fridgeId?: string; source?: string; OR?: Array<{ source: string | null }> } = {};
  if (filters.fridgeId) where.fridgeId = filters.fridgeId;
  // Null source means "fridge" (rows from before this field existed) — so
  // filtering for "fridge" has to match null too, not just the literal
  // string. Prisma doesn't allow null inside an "in" array for a nullable
  // string field, so this is expressed as OR instead.
  if (filters.source === "fridge") where.OR = [{ source: "fridge" }, { source: null }];
  else if (filters.source) where.source = filters.source;

  return prisma.feedback.findMany({
    where,
    include: { fridge: true },
    orderBy: { createdAt: "desc" },
    take: 300, // pilot scale — revisit with real pagination if volume grows
  });
};

// Averages computed in application code (consistent with getSalesStats'
// approach elsewhere) — only counts entries that actually rated that
// specific field, so a mostly-blank submission doesn't drag an average
// toward zero.
export const getFeedbackStats = async (source?: string) => {
  const where: { source?: string; OR?: Array<{ source: string | null }> } = {};
  if (source === "fridge") where.OR = [{ source: "fridge" }, { source: null }];
  else if (source) where.source = source;

  const all = await prisma.feedback.findMany({ where });

  const avg = (values: number[]) =>
    values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

  const tasteRatings = all.map((f) => f.tasteRating).filter((v): v is number => v != null);
  const quantityRatings = all.map((f) => f.quantityRating).filter((v): v is number => v != null);
  const qualityRatings = all.map((f) => f.qualityRating).filter((v): v is number => v != null);
  const recommendRatings = all.map((f) => f.recommendRating).filter((v): v is number => v != null);
  const serviceRatings = all.map((f) => f.serviceRating).filter((v): v is number => v != null);

  return {
    totalSubmissions: all.length,
    avgTaste: avg(tasteRatings),
    avgQuantity: avg(quantityRatings),
    avgQuality: avg(qualityRatings),
    avgRecommend: avg(recommendRatings),
    avgService: avg(serviceRatings),
    tasteCount: tasteRatings.length,
    quantityCount: quantityRatings.length,
    qualityCount: qualityRatings.length,
    recommendCount: recommendRatings.length,
    serviceCount: serviceRatings.length,
  };
};

// ── Subscription feedback — separate model, separate questions ─────
export const createSubscriptionFeedback = async (data: {
  name: string;
  phone?: string;
  satisfactionRating?: number;
  onTimeDeliveryRating?: number;
  goalsResultRating?: number;
  foodQualityRating?: number;
  quantityRating?: number;
  packagingRating?: number;
  recommendRating?: number;
  suggestions?: string;
  additionalRequest?: string;
  favoriteMeals?: string;
}) => {
  return prisma.subscriptionFeedback.create({
    data: {
      name: data.name,
      phone: data.phone || undefined,
      satisfactionRating: data.satisfactionRating,
      onTimeDeliveryRating: data.onTimeDeliveryRating,
      goalsResultRating: data.goalsResultRating,
      foodQualityRating: data.foodQualityRating,
      quantityRating: data.quantityRating,
      packagingRating: data.packagingRating,
      recommendRating: data.recommendRating,
      suggestions: data.suggestions || undefined,
      additionalRequest: data.additionalRequest || undefined,
      favoriteMeals: data.favoriteMeals || undefined,
    },
  });
};

export const listSubscriptionFeedback = () => {
  return prisma.subscriptionFeedback.findMany({
    orderBy: { createdAt: "desc" },
    take: 300,
  });
};

export const getSubscriptionFeedbackStats = async () => {
  const all = await prisma.subscriptionFeedback.findMany();

  const avg = (values: number[]) =>
    values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

  const satisfactionRatings = all.map((f) => f.satisfactionRating).filter((v): v is number => v != null);
  const onTimeDeliveryRatings = all.map((f) => f.onTimeDeliveryRating).filter((v): v is number => v != null);
  const goalsResultRatings = all.map((f) => f.goalsResultRating).filter((v): v is number => v != null);
  const foodQualityRatings = all.map((f) => f.foodQualityRating).filter((v): v is number => v != null);
  const quantityRatings = all.map((f) => f.quantityRating).filter((v): v is number => v != null);
  const packagingRatings = all.map((f) => f.packagingRating).filter((v): v is number => v != null);
  const recommendRatings = all.map((f) => f.recommendRating).filter((v): v is number => v != null);

  return {
    totalSubmissions: all.length,
    avgSatisfaction: avg(satisfactionRatings),
    avgOnTimeDelivery: avg(onTimeDeliveryRatings),
    avgGoalsResult: avg(goalsResultRatings),
    avgFoodQuality: avg(foodQualityRatings),
    avgQuantity: avg(quantityRatings),
    avgPackaging: avg(packagingRatings),
    avgRecommend: avg(recommendRatings),
    satisfactionCount: satisfactionRatings.length,
    onTimeDeliveryCount: onTimeDeliveryRatings.length,
    goalsResultCount: goalsResultRatings.length,
    foodQualityCount: foodQualityRatings.length,
    quantityCount: quantityRatings.length,
    packagingCount: packagingRatings.length,
    recommendCount: recommendRatings.length,
  };
};

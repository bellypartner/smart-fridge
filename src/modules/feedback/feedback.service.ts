import { prisma } from "../../config/prisma";

export const createFeedback = async (data: {
  name?: string;
  fridgeCode?: string;
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
      name: data.name || undefined,
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

export const listFeedback = (filters: { fridgeId?: string }) => {
  return prisma.feedback.findMany({
    where: filters.fridgeId ? { fridgeId: filters.fridgeId } : undefined,
    include: { fridge: true },
    orderBy: { createdAt: "desc" },
    take: 300, // pilot scale — revisit with real pagination if volume grows
  });
};

// Averages computed in application code (consistent with getSalesStats'
// approach elsewhere) — only counts entries that actually rated that
// specific field, so a mostly-blank submission doesn't drag an average
// toward zero.
export const getFeedbackStats = async () => {
  const all = await prisma.feedback.findMany();

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

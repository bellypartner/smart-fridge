import { prisma } from "../../config/prisma";
import { ApiError } from "../../utils/apiError";

export const getFridgeByCode = async (code: string) => {
  const fridge = await prisma.fridge.findUnique({ where: { code } });

  if (!fridge) {
    throw ApiError.notFound("Fridge not found for this QR code", "FRIDGE_NOT_FOUND");
  }
  if (!fridge.isActive) {
    throw ApiError.gone("This fridge is currently inactive", "FRIDGE_INACTIVE");
  }
  return fridge;
};

// Public — powers the home page's "choose your location, then fridge"
// flow. Only active fridges, and only the fields a customer needs to
// pick one (never stock, QR data, or anything internal).
export const listActiveFridges = async () => {
  return prisma.fridge.findMany({
    where: { isActive: true },
    select: { code: true, name: true, location: true },
    orderBy: [{ location: "asc" }, { name: "asc" }],
  });
};

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

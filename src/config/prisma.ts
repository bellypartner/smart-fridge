import { PrismaClient } from "@prisma/client";
import { isProd } from "./env";

// Reuse a single PrismaClient instance across hot reloads in dev,
// and across the process in production (Railway runs one instance per container).
declare global {
  // eslint-disable-next-line no-var
  var __prisma__: PrismaClient | undefined;
}

export const prisma =
  global.__prisma__ ??
  new PrismaClient({
    log: isProd ? ["error", "warn"] : ["error", "warn", "query"],
  });

if (!isProd) {
  global.__prisma__ = prisma;
}

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const SEED_ADMIN_PASSWORD = "changeme123"; // dev-only default — change immediately if you ever seed a real environment

async function main() {
  const fridge = await prisma.fridge.upsert({
    where: { code: "FRIDGE-TECHNOPARK-001" },
    update: {},
    create: {
      code: "FRIDGE-TECHNOPARK-001",
      name: "Technopark Campus 1 - Ground Floor",
      location: "Trivandrum",
    },
  });

  const category = await prisma.category.upsert({
    where: { name: "Bowls" },
    update: {},
    create: { name: "Bowls" },
  });

  const product = await prisma.product.upsert({
    where: { sku: "SC-PANEER-BOWL" },
    update: {},
    create: {
      sku: "SC-PANEER-BOWL",
      name: "Grilled Paneer Power Bowl",
      categoryId: category.id,
      calories: 420,
      proteinG: 28,
      carbsG: 35,
      fatG: 18,
      description: "Grilled paneer, quinoa, roasted vegetables, tahini dressing.",
      mrp: 220,
      sellingPrice: 199,
      gstPercent: 5,
      shelfLifeHours: 24,
    },
  });

  const now = new Date();
  const ddmm = String(now.getDate()).padStart(2, "0") + String(now.getMonth() + 1).padStart(2, "0");
  const seedBatchCode = "GRIPOW-" + ddmm;
  const batch = await prisma.batch.upsert({
    where: { batchCode: seedBatchCode },
    update: {},
    create: {
      batchCode: seedBatchCode,
      productId: product.id,
      manufacturedAt: now,
      expiresAt: new Date(now.getTime() + product.shelfLifeHours * 60 * 60 * 1000),
      totalQuantity: 20,
    },
  });

  await prisma.fridgeStock.upsert({
    where: { fridgeId_batchId: { fridgeId: fridge.id, batchId: batch.id } },
    update: { quantityAvailable: 20, quantityAllocated: 20 },
    create: { fridgeId: fridge.id, batchId: batch.id, quantityAvailable: 20, quantityAllocated: 20 },
  });

  const passwordHash = await bcrypt.hash(SEED_ADMIN_PASSWORD, 10);
  const admin = await prisma.user.upsert({
    where: { phone: "9999999999" },
    update: { passwordHash },
    create: { phone: "9999999999", name: "Syam (Admin)", role: "ADMIN", passwordHash },
  });

  // eslint-disable-next-line no-console
  console.log("Seeded:", { fridge: fridge.code, product: product.sku, batch: batch.batchCode, admin: admin.phone, adminPassword: SEED_ADMIN_PASSWORD });
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

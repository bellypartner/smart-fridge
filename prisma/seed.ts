import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

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

  const product = await prisma.product.upsert({
    where: { sku: "SC-PANEER-BOWL" },
    update: {},
    create: {
      sku: "SC-PANEER-BOWL",
      name: "Grilled Paneer Power Bowl",
      category: "Bowls",
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
  const batch = await prisma.batch.upsert({
    where: { batchCode: "SC-PANEER-BOWL-B240804" },
    update: {},
    create: {
      batchCode: "SC-PANEER-BOWL-B240804",
      productId: product.id,
      manufacturedAt: now,
      expiresAt: new Date(now.getTime() + product.shelfLifeHours * 60 * 60 * 1000),
    },
  });

  await prisma.fridgeStock.upsert({
    where: { fridgeId_batchId: { fridgeId: fridge.id, batchId: batch.id } },
    update: { quantityAvailable: 20 },
    create: { fridgeId: fridge.id, batchId: batch.id, quantityAvailable: 20 },
  });

  const admin = await prisma.user.upsert({
    where: { phone: "9999999999" },
    update: {},
    create: { phone: "9999999999", name: "Syam (Admin)", role: "ADMIN" },
  });

  // eslint-disable-next-line no-console
  console.log("Seeded:", { fridge: fridge.code, product: product.sku, batch: batch.batchCode, admin: admin.phone });
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

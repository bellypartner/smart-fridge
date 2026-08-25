import { app } from "./app";
import { env } from "./config/env";
import { startSessionSweeper } from "./modules/session/session.sweeper";
import { prisma } from "./config/prisma";

const server = app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Smart Fridge API listening on port ${env.PORT} [${env.NODE_ENV}]`);
});

const stopSweeper = startSessionSweeper();

const shutdown = async (signal: string) => {
  // eslint-disable-next-line no-console
  console.log(`${signal} received — shutting down gracefully`);
  stopSweeper();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

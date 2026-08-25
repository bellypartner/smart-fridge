import { prisma } from "../../config/prisma";
import { expireSession } from "./session.service";

const SWEEP_INTERVAL_MS = 60 * 1000; // every minute

export const startSessionSweeper = () => {
  const run = async () => {
    try {
      const stale = await prisma.shoppingSession.findMany({
        where: { status: "ACTIVE", expiresAt: { lt: new Date() } },
        select: { id: true },
        take: 100,
      });

      for (const session of stale) {
        await expireSession(session.id);
      }

      if (stale.length > 0) {
        // eslint-disable-next-line no-console
        console.log(`Session sweeper: expired ${stale.length} stale session(s)`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Session sweeper failed:", err);
    }
  };

  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  run(); // run once at startup too

  return () => clearInterval(timer);
};

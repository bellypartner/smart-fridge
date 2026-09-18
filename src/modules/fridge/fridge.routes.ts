import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import * as fridgeService from "./fridge.service";

const router = Router();

// Public — powers the home page's fridge picker. Real-time by nature:
// it's just a live query, so a fridge added/renamed/deactivated in the
// admin dashboard shows up here immediately, no separate sync needed.
router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const fridges = await fridgeService.listActiveFridges();
    res.status(200).json(fridges);
  })
);

// Fully public — no login. This is the first call the customer's browser
// makes, before any cart exists, so it can't require auth.
router.get(
  "/:code",
  asyncHandler(async (req, res) => {
    const fridge = await fridgeService.getFridgeByCode(req.params.code);
    res.status(200).json(fridge);
  })
);

export default router;

import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import * as fridgeService from "./fridge.service";

const router = Router();

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

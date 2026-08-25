import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  allocateStockSchema,
  createBatchSchema,
  createFridgeSchema,
  createProductSchema,
} from "./admin.schema";
import * as adminService from "./admin.service";

const router = Router();

router.use(requireAuth);

router.post(
  "/products",
  requireRole("ADMIN"),
  validate(createProductSchema),
  asyncHandler(async (req, res) => {
    const product = await adminService.createProduct(req.body);
    res.status(201).json(product);
  })
);

router.post(
  "/batches",
  requireRole("ADMIN", "KITCHEN"),
  validate(createBatchSchema),
  asyncHandler(async (req, res) => {
    const batch = await adminService.createBatch(req.body);
    res.status(201).json(batch);
  })
);

router.post(
  "/fridges",
  requireRole("ADMIN"),
  validate(createFridgeSchema),
  asyncHandler(async (req, res) => {
    const fridge = await adminService.createFridge(req.body);
    res.status(201).json(fridge);
  })
);

router.post(
  "/fridges/:fridgeId/stock",
  requireRole("ADMIN", "KITCHEN"),
  validate(allocateStockSchema),
  asyncHandler(async (req, res) => {
    const stock = await adminService.allocateStock(req.params.fridgeId, req.body.batchId, req.body.quantity);
    res.status(200).json(stock);
  })
);

router.get(
  "/fridges/:fridgeId/stock",
  requireRole("ADMIN", "KITCHEN"),
  asyncHandler(async (req, res) => {
    const stock = await adminService.listFridgeStock(req.params.fridgeId);
    res.status(200).json(stock);
  })
);

router.get(
  "/fridges",
  requireRole("ADMIN", "KITCHEN"),
  asyncHandler(async (_req, res) => {
    res.status(200).json(await adminService.listFridges());
  })
);

router.get(
  "/products",
  requireRole("ADMIN", "KITCHEN"),
  asyncHandler(async (_req, res) => {
    res.status(200).json(await adminService.listProducts());
  })
);

router.get(
  "/batches",
  requireRole("ADMIN", "KITCHEN"),
  asyncHandler(async (_req, res) => {
    res.status(200).json(await adminService.listBatches());
  })
);

export default router;

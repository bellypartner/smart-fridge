import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import {
  allocateStockSchema,
  createBatchSchema,
  createCategorySchema,
  createFridgeSchema,
  createProductSchema,
  customerPhoneParamSchema,
  idParamSchema,
  listOrdersQuerySchema,
  markOrderPaidSchema,
  stockParamSchema,
  updateBatchStatusSchema,
  updateCategorySchema,
  updateFridgeSchema,
  updateProductSchema,
  updateStockSchema,
} from "./admin.schema";
import * as adminService from "./admin.service";

const router = Router();

router.use(requireAuth);

// ── Categories ───────────────────────────────────────────────
router.post(
  "/categories",
  requireRole("ADMIN"),
  validate(createCategorySchema),
  asyncHandler(async (req, res) => {
    const category = await adminService.createCategory(req.body.name);
    res.status(201).json(category);
  })
);

router.get(
  "/categories",
  requireRole("ADMIN", "KITCHEN"),
  asyncHandler(async (_req, res) => {
    res.status(200).json(await adminService.listCategories());
  })
);

router.patch(
  "/categories/:id",
  requireRole("ADMIN"),
  validate(updateCategorySchema),
  asyncHandler(async (req, res) => {
    res.status(200).json(await adminService.updateCategory(req.params.id, req.body.name));
  })
);

router.delete(
  "/categories/:id",
  requireRole("ADMIN"),
  validate(idParamSchema),
  asyncHandler(async (req, res) => {
    await adminService.deleteCategory(req.params.id);
    res.status(204).send();
  })
);

// ── Products ─────────────────────────────────────────────────
router.post(
  "/products",
  requireRole("ADMIN"),
  validate(createProductSchema),
  asyncHandler(async (req, res) => {
    const product = await adminService.createProduct(req.body);
    res.status(201).json(product);
  })
);

router.get(
  "/products",
  requireRole("ADMIN", "KITCHEN"),
  asyncHandler(async (_req, res) => {
    res.status(200).json(await adminService.listProducts());
  })
);

router.patch(
  "/products/:id",
  requireRole("ADMIN"),
  validate(updateProductSchema),
  asyncHandler(async (req, res) => {
    res.status(200).json(await adminService.updateProduct(req.params.id, req.body));
  })
);

router.delete(
  "/products/:id",
  requireRole("ADMIN"),
  validate(idParamSchema),
  asyncHandler(async (req, res) => {
    await adminService.deleteProduct(req.params.id);
    res.status(204).send();
  })
);

// ── Batches ──────────────────────────────────────────────────
router.post(
  "/batches",
  requireRole("ADMIN", "KITCHEN"),
  validate(createBatchSchema),
  asyncHandler(async (req, res) => {
    const batch = await adminService.createBatch(req.body);
    res.status(201).json(batch);
  })
);

router.get(
  "/batches",
  requireRole("ADMIN", "KITCHEN"),
  asyncHandler(async (_req, res) => {
    res.status(200).json(await adminService.listBatches());
  })
);

router.patch(
  "/batches/:id",
  requireRole("ADMIN", "KITCHEN"),
  validate(updateBatchStatusSchema),
  asyncHandler(async (req, res) => {
    res.status(200).json(await adminService.updateBatchStatus(req.params.id, req.body.status));
  })
);

router.delete(
  "/batches/:id",
  requireRole("ADMIN", "KITCHEN"),
  validate(idParamSchema),
  asyncHandler(async (req, res) => {
    await adminService.deleteBatch(req.params.id);
    res.status(204).send();
  })
);

// ── Fridges ──────────────────────────────────────────────────
router.post(
  "/fridges",
  requireRole("ADMIN"),
  validate(createFridgeSchema),
  asyncHandler(async (req, res) => {
    const fridge = await adminService.createFridge(req.body);
    res.status(201).json(fridge);
  })
);

router.get(
  "/fridges",
  requireRole("ADMIN", "KITCHEN"),
  asyncHandler(async (_req, res) => {
    res.status(200).json(await adminService.listFridges());
  })
);

router.patch(
  "/fridges/:id",
  requireRole("ADMIN"),
  validate(updateFridgeSchema),
  asyncHandler(async (req, res) => {
    res.status(200).json(await adminService.updateFridge(req.params.id, req.body));
  })
);

router.delete(
  "/fridges/:id",
  requireRole("ADMIN"),
  validate(idParamSchema),
  asyncHandler(async (req, res) => {
    await adminService.deleteFridge(req.params.id);
    res.status(204).send();
  })
);

// ── Stock ────────────────────────────────────────────────────
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

router.patch(
  "/fridges/:fridgeId/stock/:batchId",
  requireRole("ADMIN", "KITCHEN"),
  validate(updateStockSchema),
  asyncHandler(async (req, res) => {
    const stock = await adminService.setStockQuantity(req.params.fridgeId, req.params.batchId, req.body);
    res.status(200).json(stock);
  })
);

router.delete(
  "/fridges/:fridgeId/stock/:batchId",
  requireRole("ADMIN", "KITCHEN"),
  validate(stockParamSchema),
  asyncHandler(async (req, res) => {
    await adminService.deleteStock(req.params.fridgeId, req.params.batchId);
    res.status(204).send();
  })
);

// Daily perishable close-out: records whatever's left as waste, zeroes
// availability, and flips the batch to EXPIRED.
router.post(
  "/fridges/:fridgeId/stock/:batchId/close-out",
  requireRole("ADMIN", "KITCHEN"),
  validate(stockParamSchema),
  asyncHandler(async (req, res) => {
    const result = await adminService.closeOutStock(req.params.fridgeId, req.params.batchId);
    res.status(200).json(result);
  })
);

// ── Orders / Sales — ADMIN only, revenue isn't shown to kitchen staff ──
router.get(
  "/orders",
  requireRole("ADMIN"),
  validate(listOrdersQuerySchema),
  asyncHandler(async (req, res) => {
    const { status, fridgeId } = req.query as { status?: string; fridgeId?: string };
    res.status(200).json(await adminService.listOrders({ status, fridgeId }));
  })
);

router.get(
  "/orders/stats",
  requireRole("ADMIN"),
  asyncHandler(async (_req, res) => {
    res.status(200).json(await adminService.getSalesStats());
  })
);

// Manual override for a payment that genuinely captured in Razorpay but
// whose webhook never reached us — see admin.service.ts for the full
// rationale. Deliberately ADMIN-only, not KITCHEN — this bypasses the
// normal payment-verification path and should be used sparingly, after
// checking Razorpay's dashboard directly.
router.post(
  "/orders/:orderId/mark-paid",
  requireRole("ADMIN"),
  validate(markOrderPaidSchema),
  asyncHandler(async (req, res) => {
    const order = await adminService.markOrderPaidManually(
      req.params.orderId,
      req.user!.sub,
      req.body?.razorpayPaymentId
    );
    res.status(200).json(order);
  })
);

// ── Customers — ADMIN only ──────────────────────────────────
router.get(
  "/customers",
  requireRole("ADMIN"),
  asyncHandler(async (_req, res) => {
    res.status(200).json(await adminService.listCustomers());
  })
);

router.get(
  "/customers/:phone",
  requireRole("ADMIN"),
  validate(customerPhoneParamSchema),
  asyncHandler(async (req, res) => {
    res.status(200).json(await adminService.getCustomerHistory(req.params.phone));
  })
);

export default router;

import { Request, Response } from "express";
import * as feedbackService from "./feedback.service";

export const createFeedback = async (req: Request, res: Response) => {
  const feedback = await feedbackService.createFeedback({ ...req.body, source: "fridge" });
  res.status(201).json({ id: feedback.id });
};

export const createDeliveryFeedback = async (req: Request, res: Response) => {
  const feedback = await feedbackService.createFeedback({ ...req.body, source: "swiggy_zomato" });
  res.status(201).json({ id: feedback.id });
};

export const listFeedback = async (req: Request, res: Response) => {
  const { fridgeId, source } = req.query as { fridgeId?: string; source?: string };
  res.status(200).json(await feedbackService.listFeedback({ fridgeId, source }));
};

export const getFeedbackStats = async (req: Request, res: Response) => {
  const { source } = req.query as { source?: string };
  res.status(200).json(await feedbackService.getFeedbackStats(source));
};

export const createSubscriptionFeedback = async (req: Request, res: Response) => {
  const feedback = await feedbackService.createSubscriptionFeedback(req.body);
  res.status(201).json({ id: feedback.id });
};

export const listSubscriptionFeedback = async (_req: Request, res: Response) => {
  res.status(200).json(await feedbackService.listSubscriptionFeedback());
};

export const getSubscriptionFeedbackStats = async (_req: Request, res: Response) => {
  res.status(200).json(await feedbackService.getSubscriptionFeedbackStats());
};

export const getLatestFeedbackAt = async (_req: Request, res: Response) => {
  res.status(200).json(await feedbackService.getLatestFeedbackAt());
};

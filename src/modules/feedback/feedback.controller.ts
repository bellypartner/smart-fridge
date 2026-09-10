import { Request, Response } from "express";
import * as feedbackService from "./feedback.service";

export const createFeedback = async (req: Request, res: Response) => {
  const feedback = await feedbackService.createFeedback(req.body);
  res.status(201).json({ id: feedback.id });
};

export const listFeedback = async (req: Request, res: Response) => {
  const { fridgeId } = req.query as { fridgeId?: string };
  res.status(200).json(await feedbackService.listFeedback({ fridgeId }));
};

export const getFeedbackStats = async (_req: Request, res: Response) => {
  res.status(200).json(await feedbackService.getFeedbackStats());
};

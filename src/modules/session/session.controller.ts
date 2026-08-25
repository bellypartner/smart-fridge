import { Request, Response } from "express";
import * as sessionService from "./session.service";

export const createSession = async (req: Request, res: Response) => {
  const session = await sessionService.createSession(req.body.fridgeCode);
  res.status(201).json(session);
};

export const scanBatch = async (req: Request, res: Response) => {
  const result = await sessionService.scanBatch(req.params.sessionId, req.body.batchCode);
  res.status(200).json(result);
};

export const updateCartItem = async (req: Request, res: Response) => {
  const result = await sessionService.updateCartItemQuantity(
    req.params.sessionId,
    req.params.itemId,
    req.body.quantity
  );
  res.status(200).json(result);
};

export const getCart = async (req: Request, res: Response) => {
  const cart = await sessionService.getCart(req.params.sessionId);
  res.status(200).json(cart);
};

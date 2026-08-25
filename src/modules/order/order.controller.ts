import { Request, Response } from "express";
import * as orderService from "./order.service";

export const checkout = async (req: Request, res: Response) => {
  const result = await orderService.checkout(req.params.sessionId, req.body.name, req.body.phone);
  res.status(201).json(result);
};

export const getOrder = async (req: Request, res: Response) => {
  const order = await orderService.getOrder(req.params.orderId);
  res.status(200).json(order);
};

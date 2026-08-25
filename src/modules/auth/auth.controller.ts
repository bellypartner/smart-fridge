import { Request, Response } from "express";
import * as authService from "./auth.service";

export const requestOtp = async (req: Request, res: Response) => {
  const { phone } = req.body;
  await authService.requestOtp(phone);
  res.status(200).json({ message: "OTP sent" });
};

export const verifyOtp = async (req: Request, res: Response) => {
  const { phone, code, name } = req.body;
  const tokens = await authService.verifyOtp(phone, code, name);
  res.status(200).json(tokens);
};

export const refresh = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  const tokens = await authService.rotateRefreshToken(refreshToken);
  res.status(200).json(tokens);
};

export const logout = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  await authService.logout(refreshToken);
  res.status(200).json({ message: "Logged out" });
};

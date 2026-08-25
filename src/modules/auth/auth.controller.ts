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

export const login = async (req: Request, res: Response) => {
  const { phone, password } = req.body;
  const tokens = await authService.login(phone, password);
  res.status(200).json(tokens);
};

export const bootstrapAdmin = async (req: Request, res: Response) => {
  const { phone, password, name, secret } = req.body;
  const tokens = await authService.bootstrapAdmin(phone, password, name, secret);
  res.status(201).json(tokens);
};

export const createStaff = async (req: Request, res: Response) => {
  const { phone, password, name, role } = req.body;
  const staff = await authService.createStaff(phone, password, name, role);
  res.status(201).json(staff);
};

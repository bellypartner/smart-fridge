import crypto from "crypto";
import bcrypt from "bcryptjs";

export const generateOtp = (): string => {
  // 6-digit numeric OTP
  return crypto.randomInt(100000, 999999).toString();
};

export const hashOtp = async (otp: string): Promise<string> => {
  return bcrypt.hash(otp, 10);
};

export const compareOtp = async (otp: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(otp, hash);
};

export const hashToken = (token: string): string => {
  return crypto.createHash("sha256").update(token).digest("hex");
};

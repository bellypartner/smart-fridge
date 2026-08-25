import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { ApiError } from "../../utils/apiError";
import { compareOtp, generateOtp, hashOtp, hashToken } from "../../utils/otp";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt";

// ── SMS provider ────────────────────────────────────────────────
// Swap this for the real provider (MSG91 / Twilio / etc). Kept as an
// interface so the rest of auth flow never changes when the provider does.
interface SmsProvider {
  sendOtp(phone: string, otp: string): Promise<void>;
}

const consoleSmsProvider: SmsProvider = {
  async sendOtp(phone, otp) {
    // eslint-disable-next-line no-console
    console.log(`[SMS STUB] OTP for ${phone}: ${otp}`);
  },
};

const smsProvider: SmsProvider = consoleSmsProvider;

// ── Request OTP ─────────────────────────────────────────────────
export const requestOtp = async (phone: string): Promise<void> => {
  const otp = generateOtp();
  const codeHash = await hashOtp(otp);
  const expiresAt = new Date(Date.now() + env.OTP_EXPIRES_IN_MINUTES * 60 * 1000);

  await prisma.otpCode.create({
    data: { phone, codeHash, expiresAt },
  });

  await smsProvider.sendOtp(phone, otp);
};

// ── Verify OTP → issue tokens, create user if first login ──────
export const verifyOtp = async (phone: string, code: string, name?: string) => {
  const latestOtp = await prisma.otpCode.findFirst({
    where: { phone, verifiedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!latestOtp) {
    throw ApiError.badRequest("No pending OTP for this number. Request a new one.", "OTP_NOT_FOUND");
  }

  if (latestOtp.expiresAt < new Date()) {
    throw ApiError.badRequest("OTP has expired. Request a new one.", "OTP_EXPIRED");
  }

  if (latestOtp.attempts >= env.OTP_MAX_ATTEMPTS) {
    throw ApiError.badRequest("Too many incorrect attempts. Request a new OTP.", "OTP_LOCKED");
  }

  const isValid = await compareOtp(code, latestOtp.codeHash);

  if (!isValid) {
    await prisma.otpCode.update({
      where: { id: latestOtp.id },
      data: { attempts: { increment: 1 } },
    });
    throw ApiError.badRequest("Incorrect OTP", "OTP_INVALID");
  }

  await prisma.otpCode.update({
    where: { id: latestOtp.id },
    data: { verifiedAt: new Date() },
  });

  const user = await prisma.user.upsert({
    where: { phone },
    update: { name: name ?? undefined },
    create: { phone, name },
  });

  if (!user.isActive) {
    throw ApiError.forbidden("This account has been disabled");
  }

  return issueTokens(user.id, user.phone, user.role);
};

// ── Token issuance / refresh ────────────────────────────────────
export const issueTokens = async (userId: string, phone: string, role: "KITCHEN" | "ADMIN") => {
  const accessToken = signAccessToken({ sub: userId, phone, role });
  const refreshToken = signRefreshToken(userId);

  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  return { accessToken, refreshToken, userId, role };
};

export const rotateRefreshToken = async (refreshToken: string) => {
  let decoded: { sub: string };
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized("Invalid or expired refresh token");
  }

  const tokenHash = hashToken(refreshToken);
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

  if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
    throw ApiError.unauthorized("Refresh token is no longer valid");
  }

  const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
  if (!user || !user.isActive) {
    throw ApiError.unauthorized("Account not found or disabled");
  }

  // rotate: revoke old, issue new
  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() },
  });

  return issueTokens(user.id, user.phone, user.role);
};

export const logout = async (refreshToken: string) => {
  const tokenHash = hashToken(refreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
};

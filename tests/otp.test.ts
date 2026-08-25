import { describe, expect, it } from "vitest";
import { compareOtp, generateOtp, hashOtp, hashToken } from "../src/utils/otp";

describe("otp utils", () => {
  it("generates a 6-digit numeric OTP", () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it("generated OTPs are not all identical across calls", () => {
    const samples = new Set(Array.from({ length: 20 }, () => generateOtp()));
    expect(samples.size).toBeGreaterThan(1);
  });

  it("hashOtp/compareOtp round-trips correctly", async () => {
    const otp = "123456";
    const hash = await hashOtp(otp);
    expect(hash).not.toBe(otp);
    await expect(compareOtp(otp, hash)).resolves.toBe(true);
    await expect(compareOtp("000000", hash)).resolves.toBe(false);
  });

  it("hashToken is deterministic for the same input", () => {
    const token = "some-refresh-token-value";
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("hashToken differs for different inputs", () => {
    expect(hashToken("token-a")).not.toBe(hashToken("token-b"));
  });
});

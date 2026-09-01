import { describe, expect, it } from "vitest";
import { buildBatchCode } from "../src/utils/batchCode";

describe("buildBatchCode", () => {
  it("matches the specified example: Chicken Salad -> CHISAL, no fridge, DDMM suffix", () => {
    const date = new Date(2026, 7, 4); // Aug 4, 2026 (month is 0-indexed)
    expect(buildBatchCode("Chicken Salad", date)).toBe("CHISAL-0408");
  });

  it("uses first 6 letters for a single-word product name", () => {
    const date = new Date(2026, 0, 1);
    expect(buildBatchCode("Smoothie", date)).toBe("SMOOTH-0101");
  });

  it("pads short words with X", () => {
    const date = new Date(2026, 0, 1);
    expect(buildBatchCode("Go Bowl", date)).toBe("GOXBOW-0101");
  });

  it("ignores words beyond the first two", () => {
    const date = new Date(2026, 0, 1);
    expect(buildBatchCode("Grilled Paneer Power Bowl", date)).toBe("GRIPAN-0101");
  });

  it("formats the date as DDMM with zero-padding, no year", () => {
    const date = new Date(2026, 2, 5); // Mar 5, 2026
    expect(buildBatchCode("Wrap", date)).toBe("WRAPXX-0503");
  });

  it("never includes a fridge code or SC prefix", () => {
    const date = new Date(2026, 7, 27);
    const code = buildBatchCode("Chicken Salad", date);
    expect(code.startsWith("SC")).toBe(false);
    expect(code).toBe("CHISAL-2708");
  });
});

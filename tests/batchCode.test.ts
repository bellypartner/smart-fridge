import { describe, expect, it } from "vitest";
import { buildBatchCode } from "../src/utils/batchCode";

describe("buildBatchCode", () => {
  it("matches the specified example: Chicken Salad -> CHISAL, no SC prefix, DDMM suffix", () => {
    const date = new Date(2026, 7, 4); // Aug 4, 2026 (month is 0-indexed)
    expect(buildBatchCode("FRIDGE-TECHNOPARK-001", "Chicken Salad", date)).toBe(
      "FRIDGE-TECHNOPARK-001-CHISAL-0408"
    );
  });

  it("uses first 6 letters for a single-word product name", () => {
    const date = new Date(2026, 0, 1);
    expect(buildBatchCode("FRIDGE-001", "Smoothie", date)).toBe("FRIDGE-001-SMOOTH-0101");
  });

  it("pads short words with X", () => {
    const date = new Date(2026, 0, 1);
    expect(buildBatchCode("FRIDGE-001", "Go Bowl", date)).toBe("FRIDGE-001-GOXBOW-0101");
  });

  it("ignores words beyond the first two", () => {
    const date = new Date(2026, 0, 1);
    expect(buildBatchCode("FRIDGE-001", "Grilled Paneer Power Bowl", date)).toBe(
      "FRIDGE-001-GRIPAN-0101"
    );
  });

  it("formats the date as DDMM with zero-padding, no year", () => {
    const date = new Date(2026, 2, 5); // Mar 5, 2026
    expect(buildBatchCode("F1", "Wrap", date)).toBe("F1-WRAPXX-0503");
  });

  it("never includes an SC prefix", () => {
    const date = new Date(2026, 7, 27);
    const code = buildBatchCode("IBS-NILA", "Chicken Salad", date);
    expect(code.startsWith("SC")).toBe(false);
    expect(code).toBe("IBS-NILA-CHISAL-2708");
  });
});

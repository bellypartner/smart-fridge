import { describe, expect, it } from "vitest";
import { buildBatchCode } from "../src/utils/batchCode";

describe("buildBatchCode", () => {
  it("matches the specified example: Chicken Salad -> CHISAL", () => {
    const date = new Date(2026, 7, 4); // Aug 4, 2026 (month is 0-indexed)
    expect(buildBatchCode("FRIDGE-TECHNOPARK-001", "Chicken Salad", date)).toBe(
      "SC-FRIDGE-TECHNOPARK-001-CHISAL-260804"
    );
  });

  it("uses first 6 letters for a single-word product name", () => {
    const date = new Date(2026, 0, 1);
    expect(buildBatchCode("FRIDGE-001", "Smoothie", date)).toBe("SC-FRIDGE-001-SMOOTH-260101");
  });

  it("pads short words with X", () => {
    const date = new Date(2026, 0, 1);
    expect(buildBatchCode("FRIDGE-001", "Go Bowl", date)).toBe("SC-FRIDGE-001-GOXBOW-260101");
  });

  it("ignores words beyond the first two", () => {
    const date = new Date(2026, 0, 1);
    expect(buildBatchCode("FRIDGE-001", "Grilled Paneer Power Bowl", date)).toBe(
      "SC-FRIDGE-001-GRIPAN-260101"
    );
  });

  it("formats the date as YYMMDD with zero-padding", () => {
    const date = new Date(2026, 2, 5); // Mar 5, 2026
    expect(buildBatchCode("F1", "Wrap", date)).toBe("SC-F1-WRAPXX-260305");
  });
});

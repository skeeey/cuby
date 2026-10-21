import { describe, expect, it } from "vitest";
import { formatCuberouterRemaining } from "../cuberouter-money.js";

const CNY = {
  displayType: "CNY" as const,
  quotaPerUnit: 500000,
  usdToCurrencyRate: 7.3,
  symbol: "¥"
};
const HKD = {
  displayType: "CUSTOM" as const,
  quotaPerUnit: 500000,
  usdToCurrencyRate: 7.3,
  symbol: "HKD"
};
const TOKENS = {
  displayType: "TOKENS" as const,
  quotaPerUnit: 500000,
  usdToCurrencyRate: 1,
  symbol: ""
};

describe("cuberouter remaining amount", () => {
  it("converts raw quota to CNY and keeps two decimals", () => {
    expect(formatCuberouterRemaining(3_650_000, CNY, "zh-CN")).toBe("¥53.29");
  });

  it("uses four decimals below one currency unit", () => {
    expect(formatCuberouterRemaining(10_000, CNY, "zh-CN")).toBe("¥0.146");
  });

  it("renders a custom currency symbol before the amount", () => {
    expect(formatCuberouterRemaining(500_000, HKD, "zh-CN")).toBe("HKD 7.3");
  });

  it("keeps the raw quota when the instance displays tokens or reports no currency", () => {
    expect(formatCuberouterRemaining(500_000, TOKENS, "zh-CN")).toBe("500,000");
    expect(formatCuberouterRemaining(500_000, undefined, "zh-CN")).toBe("500,000");
  });
});

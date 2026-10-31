import { describe, expect, it } from "vitest";
import { formatAmount, formatTokenAmount, fromUnits, sumBalances, toUnits } from "../src";

describe("amounts", () => {
  it("toUnits", () => {
    expect(toUnits("1.5")).toBe("1500000");
    expect(toUnits("0.000001")).toBe("1");
    expect(toUnits("1,240.50")).toBe("1240500000");
    expect(toUnits(".5")).toBe("500000");
    expect(toUnits("12")).toBe("12000000");
    expect(toUnits("1.5", 18)).toBe("1500000000000000000");
    expect(() => toUnits("0.0000001")).toThrow();
    expect(() => toUnits("abc")).toThrow();
    expect(() => toUnits("-1")).toThrow();
    expect(() => toUnits("")).toThrow();
  });
  it("fromUnits", () => {
    expect(fromUnits("1500000")).toBe("1.5");
    expect(fromUnits("1")).toBe("0.000001");
    expect(fromUnits("0")).toBe("0");
    expect(fromUnits("100000000")).toBe("100");
  });
  it("formatAmount", () => {
    expect(formatAmount("1240500000")).toBe("1,240.50");
    expect(formatAmount("0")).toBe("0.00");
    expect(formatAmount("1234567")).toBe("1.234567");
    expect(formatAmount("1234567", { maxFraction: 2 })).toBe("1.23");
    expect(formatAmount("999999999999999999")).toBe("999,999,999,999.999999");
    expect(formatAmount("1000000", { minFraction: 0 })).toBe("1");
    expect(formatTokenAmount("120500000", "usdc")).toBe("120.50 USDC");
  });
  it("sumBalances", () => {
    expect(sumBalances({ usdc: "1000000", usdt: "2500000" })).toBe("3500000");
    expect(sumBalances({ usdc: "340282366920938463463374607431768211455", usdt: "1" })).toBe("340282366920938463463374607431768211456");
  });
});

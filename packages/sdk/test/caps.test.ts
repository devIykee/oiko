import { describe, expect, it } from "vitest";
import { DEFAULT_CAPS, defaultCaps, plainToUnits } from "../src/caps";

const U = (n: number) => String(Math.round(n * 1e6));

describe("default agent caps (single source)", () => {
  it("defaults are 40 / 50 / 100", () => {
    expect(DEFAULT_CAPS).toEqual({ perTx: 40, daily: 50, weekly: 100 });
    expect(defaultCaps("custom")).toEqual({ perTx: "40", daily: "50", weekly: "100" });
    expect(defaultCaps("bills", [])).toEqual({ perTx: "40", daily: "50", weekly: "100" });
  });
  it("one 35.00 bill no longer gives 38.50 everywhere: whole amounts, never below defaults", () => {
    expect(defaultCaps("bills", [U(35)])).toEqual({ perTx: "40", daily: "50", weekly: "100" });
  });
  it("covers the biggest bill and the bills total + 10%, rounded up, ordered", () => {
    const c = defaultCaps("bills", [U(35), U(25), U(150)]);
    expect(c).toEqual({ perTx: "165", daily: "231", weekly: "231" });
    expect(Number(c.perTx) <= Number(c.daily) && Number(c.daily) <= Number(c.weekly)).toBe(true);
  });
  it("coach has no spending caps", () => {
    expect(defaultCaps("coach")).toEqual({ perTx: "0", daily: "0", weekly: "0" });
  });
  it("plain amounts convert to base units exactly (no float drift)", () => {
    expect(plainToUnits("40")).toBe("40000000");
    expect(plainToUnits("38.5")).toBe("38500000");
    expect(plainToUnits("0.000001")).toBe("1");
    for (const bad of ["", "-1", "0", "1e3", "abc", "1.1234567"]) expect(plainToUnits(bad)).toBe("0");
  });
});

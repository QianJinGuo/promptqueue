import { describe, it, expect } from "vitest";
import { calculateCost, getModelPricing } from "../pricing.js";

describe("calculateCost", () => {
  it("calculates cost for Claude Sonnet", () => {
    const cost = calculateCost("claude-sonnet-4-6", 1000, 500);
    // input: (1000/1M) * $3 = $0.003, output: (500/1M) * $15 = $0.0075
    // total = $0.0105
    expect(cost).toBe(0.0105);
  });

  it("calculates cost for Claude Haiku", () => {
    const cost = calculateCost("claude-haiku-4-5-20251001", 10000, 2000);
    // input: (10000/1M) * $0.8 = $0.008, output: (2000/1M) * $4 = $0.008
    // total = $0.016
    expect(cost).toBe(0.016);
  });

  it("calculates cost for GPT-4.1", () => {
    const cost = calculateCost("gpt-4.1", 5000, 1000);
    // input: (5000/1M) * $2 = $0.01, output: (1000/1M) * $8 = $0.008
    // total = $0.018
    expect(cost).toBe(0.018);
  });

  it("returns 0 for unknown model", () => {
    const cost = calculateCost("unknown-model", 1000, 500);
    expect(cost).toBe(0);
  });

  it("handles zero tokens", () => {
    const cost = calculateCost("claude-sonnet-4-6", 0, 0);
    expect(cost).toBe(0);
  });
});

describe("getModelPricing", () => {
  it("returns pricing for known model", () => {
    const pricing = getModelPricing("claude-sonnet-4-6");
    expect(pricing).toEqual({ input: 3.0, output: 15.0 });
  });

  it("returns undefined for unknown model", () => {
    const pricing = getModelPricing("nonexistent");
    expect(pricing).toBeUndefined();
  });
});

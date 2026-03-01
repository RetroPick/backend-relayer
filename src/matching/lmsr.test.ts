import { describe, it, expect } from "vitest";
import {
  cost,
  prices,
  costBuy,
  costSwap,
  costSell,
  slippageBps,
  openInterest,
  liquidityParam,
  avgExecutionPriceBuy,
  type LMSRParams,
} from "./lmsr.js";

const params: LMSRParams = { b: 100 };

describe("LMSR Engine", () => {
  describe("cost()", () => {
    it("C(q)=b·ln(Σ exp(q_i/b)); at q=0 gives b·ln(n)", () => {
      const n = 3;
      const q = Array(n).fill(0);
      const c = cost(q, params);
      const expected = params.b * Math.log(n);
      expect(c).toBeCloseTo(expected, 10);
    });

    it("returns 0 for empty q", () => {
      expect(cost([], params)).toBe(0);
    });
  });

  describe("prices()", () => {
    it("sum to 1", () => {
      const q = [0, 0, 0];
      const p = prices(q, params);
      expect(p.reduce((a, x) => a + x, 0)).toBeCloseTo(1, 10);
    });

    it("symmetric when q symmetric", () => {
      const q = [5, 5, 5];
      const p = prices(q, params);
      expect(p[0]).toBeCloseTo(p[1], 10);
      expect(p[1]).toBeCloseTo(p[2], 10);
    });

    it("returns empty for empty q", () => {
      expect(prices([], params)).toEqual([]);
    });
  });

  describe("costBuy()", () => {
    it("positive cost for buy", () => {
      const q = [0, 0, 0];
      const cb = costBuy(q, 0, 10, params);
      expect(cb).toBeGreaterThan(0);
    });

    it("matches manual C(q+δe_k)-C(q)", () => {
      const q = [5, -3, 2];
      const delta = 10;
      const cb = costBuy(q, 1, delta, params);
      const qNext = [...q];
      qNext[1] = (qNext[1] ?? 0) + delta;
      const manual = cost(qNext, params) - cost(q, params);
      expect(cb).toBeCloseTo(manual, 10);
    });
  });

  describe("costSell()", () => {
    it("costSell(q,k,δ) = costBuy(q,k,-δ); negative = receive", () => {
      const q = [5, 0, 0];
      const delta = 2;
      const cs = costSell(q, 0, delta, params);
      const cb = costBuy(q, 0, -delta, params);
      expect(cs).toBeCloseTo(cb, 10);
      expect(cs).toBeLessThan(0);
    });
  });

  describe("costSwap()", () => {
    it("sell-dominant swap has negative cost (trader receives)", () => {
      const q = [10, 0, 0]; // outcome 0 heavily bought
      const costVal = costSwap(q, 0, 1, 5, params);
      expect(costVal).toBeLessThan(0);
    });

    it("buy-dominant swap has positive cost (swap from cheap to expensive outcome)", () => {
      const q = [10, 0, 0]; // outcome 0 expensive
      const costVal = costSwap(q, 1, 0, 5, params); // sell 1, buy 0
      expect(costVal).toBeGreaterThan(0);
    });
  });

  describe("slippageBps()", () => {
    it("slippage increases with delta", () => {
      const q = [0, 0, 0];
      const slip1 = slippageBps(q, 0, 1, params);
      const slip2 = slippageBps(q, 0, 50, params);
      expect(slip2).toBeGreaterThan(slip1);
    });
  });

  describe("openInterest()", () => {
    it("OI = Σ max(0, q_i)", () => {
      const q = [10, -5, 3];
      const oi = openInterest(q);
      expect(oi).toBe(13); // 10 + 0 + 3
    });
  });

  describe("liquidityParam()", () => {
    it("b(q) = b0 + α·OI when b0, alpha set", () => {
      const lsParams: LMSRParams = { b: 50, b0: 100, alpha: 0.1 };
      const q = [10, 20, 0]; // OI = 30
      const b = liquidityParam(q, lsParams);
      expect(b).toBeCloseTo(100 + 0.1 * 30, 10); // 103
    });

    it("returns b when b0/alpha not set", () => {
      const q = [1, 2, 3];
      expect(liquidityParam(q, params)).toBe(params.b);
    });
  });

  describe("avgExecutionPriceBuy()", () => {
    it("p̄ = costBuy/δ for δ > 0", () => {
      const q = [0, 0, 0];
      const delta = 10;
      const cb = costBuy(q, 0, delta, params);
      const avgPrice = avgExecutionPriceBuy(q, 0, delta, params);
      expect(avgPrice).toBeCloseTo(cb / delta, 10);
    });

    it("returns 0 for delta <= 0", () => {
      expect(avgExecutionPriceBuy([0, 0], 0, 0, params)).toBe(0);
    });
  });
});

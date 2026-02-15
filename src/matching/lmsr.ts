/**
 * LS-LMSR (Liquidity-Sensitive Logarithmic Market Scoring Rule) pricing engine.
 * Whitepaper Section 5: c(q) = b·ln(Σ exp(q_i/b)); p_i(q) = exp(q_i/b) / Σ exp(q_j/b)
 * Supports liquidity-sensitive extension: b(q) = b0 + α·OI(q)
 */

export interface LMSRParams {
  b: number;       // liquidity parameter
  b0?: number;     // base liquidity for LS extension
  alpha?: number;  // OI sensitivity
}

/**
 * Open interest OI(q) = Σ q_i
 */
export function openInterest(q: number[]): number {
  return q.reduce((s, x) => s + Math.max(0, x), 0);
}

/**
 * Liquidity parameter: b(q) = b0 + α·OI(q) if params provide b0, alpha
 */
export function liquidityParam(q: number[], params: LMSRParams): number {
  if (params.b0 !== undefined && params.alpha !== undefined) {
    return params.b0 + params.alpha * openInterest(q);
  }
  return params.b;
}

/**
 * Cost function: C(q) = b·ln(Σ exp(q_i/b))
 * Numerically stable: subtract max(q) before exp to avoid overflow
 */
export function cost(q: number[], params: LMSRParams): number {
  if (q.length === 0) return 0;
  const b = liquidityParam(q, params);
  const qMax = Math.max(...q);
  const terms = q.map((qi) => Math.exp((qi - qMax) / b));
  const sum = terms.reduce((a, t) => a + t, 0);
  return b * (Math.log(sum) + qMax / b);
}

/**
 * Price vector: p_i(q) = exp(q_i/b) / Σ exp(q_j/b)
 */
export function prices(q: number[], params: LMSRParams): number[] {
  if (q.length === 0) return [];
  const b = liquidityParam(q, params);
  const qMax = Math.max(...q);
  const expTerms = q.map((qi) => Math.exp((qi - qMax) / b));
  const sum = expTerms.reduce((a, t) => a + t, 0);
  return expTerms.map((t) => t / sum);
}

/**
 * CostBuy(q, k, δ) = C(q + δ·e_k) - C(q)
 */
export function costBuy(q: number[], k: number, delta: number, params: LMSRParams): number {
  const qNext = [...q];
  while (qNext.length <= k) qNext.push(0);
  qNext[k] = (qNext[k] ?? 0) + delta;
  return cost(qNext, params) - cost(q, params);
}

/**
 * CostSwap(q, i, j, δ) = C(q - δ·e_i + δ·e_j) - C(q)
 */
export function costSwap(q: number[], i: number, j: number, delta: number, params: LMSRParams): number {
  const qNext = q.map((v, idx) => {
    if (idx === i) return v - delta;
    if (idx === j) return v + delta;
    return v;
  });
  return cost(qNext, params) - cost(q, params);
}

/**
 * Average execution price for BuyShares: p̄_k(q,δ) = CostBuy(q,k,δ) / δ
 */
export function avgExecutionPriceBuy(q: number[], k: number, delta: number, params: LMSRParams): number {
  if (delta <= 0) return 0;
  return costBuy(q, k, delta, params) / delta;
}

/**
 * Slippage in bps: SlipBps = 10^4 * (p̄ - p_k) / p_k
 */
export function slippageBps(
  q: number[],
  k: number,
  delta: number,
  params: LMSRParams
): number {
  const p = prices(q, params);
  const pk = p[k] ?? 0;
  if (pk <= 0) return 0;
  const pBar = avgExecutionPriceBuy(q, k, delta, params);
  return Math.round(10000 * (pBar - pk) / pk);
}

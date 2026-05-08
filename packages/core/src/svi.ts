import type { SviParams } from "./types";

export function evaluateSviTotalVariance(params: SviParams, logMoneyness: number): number {
  const centered = logMoneyness - params.m;
  const curvature = Math.sqrt(centered * centered + params.sigma * params.sigma);
  return Math.max(0.0001, params.a + params.b * (params.rho * centered + curvature));
}

export function impliedVolFromSvi(
  params: SviParams,
  strike: number,
  forward: number,
  yearsToExpiry: number,
): number {
  const logMoneyness = Math.log(strike / forward);
  const totalVariance = evaluateSviTotalVariance(params, logMoneyness);
  return Math.sqrt(totalVariance / Math.max(yearsToExpiry, 1 / 365));
}

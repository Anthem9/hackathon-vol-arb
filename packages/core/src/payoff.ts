export type PayoffFunction = (spotAtExpiry: number) => number;

export function binaryAbove(strike: number, payout = 1): PayoffFunction {
  return (spot) => (spot > strike ? payout : 0);
}

export function callPayoff(strike: number): PayoffFunction {
  return (spot) => Math.max(spot - strike, 0);
}

export function putPayoff(strike: number): PayoffFunction {
  return (spot) => Math.max(strike - spot, 0);
}

export function rangeBinary(lower: number, upper: number, payout = 1): PayoffFunction {
  return (spot) => (spot >= lower && spot <= upper ? payout : 0);
}

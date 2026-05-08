export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalCdf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * abs);
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-abs * abs);
  return 0.5 * (1 + sign * erf);
}

export function binaryAboveFairValue(
  spot: number,
  strike: number,
  iv: number,
  yearsToExpiry: number,
): number {
  const volTime = Math.max(iv * Math.sqrt(Math.max(yearsToExpiry, 1 / 365)), 0.0001);
  const z = (Math.log(spot / strike) - 0.5 * iv * iv * yearsToExpiry) / volTime;
  return clamp(normalCdf(z), 0.01, 0.99);
}

export function probabilityToDisplayIv(probability: number, strike: number, spot: number): number {
  const distance = Math.abs(strike / spot - 1);
  return clamp(0.35 + distance * 2.2 + Math.abs(probability - 0.5) * 0.25, 0.28, 1.25);
}

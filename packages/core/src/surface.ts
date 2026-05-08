import { probabilityToDisplayIv } from "./pricing";
import type { NormalizedInstrument, SurfacePoint, VolSurface } from "./types";

export function buildSurface(
  label: string,
  expiry: number,
  instruments: NormalizedInstrument[],
  deepbookFairValues: Map<number, number>,
  spot: number,
  options: Partial<Pick<VolSurface, "venue" | "surfaceQualityScore" | "staleScore" | "lastUpdatedAt">> = {},
): VolSurface {
  const points: SurfacePoint[] = instruments
    .filter((instrument) => instrument.expiry === expiry && typeof instrument.strike === "number")
    .map((instrument) => {
      const strike = instrument.strike ?? spot;
      const externalBid = instrument.bid ?? 0;
      const externalAsk = instrument.ask ?? 0;
      const externalMid = instrument.mid ?? (externalBid + externalAsk) / 2;
      const deepbookFairBinary = deepbookFairValues.get(strike) ?? externalMid;
      return {
        strike,
        deepbookIv: probabilityToDisplayIv(deepbookFairBinary, strike, spot),
        externalBidIv: probabilityToDisplayIv(externalBid, strike, spot),
        externalMidIv: probabilityToDisplayIv(externalMid, strike, spot),
        externalAskIv: probabilityToDisplayIv(externalAsk, strike, spot),
        deepbookFairBinary,
        externalBid,
        externalMid,
        externalAsk,
      };
    })
    .sort((a, b) => a.strike - b.strike);

  return {
    venue: options.venue ?? "DeepBook + External Mock",
    underlying: "BTC",
    expiry,
    label,
    points,
    surfaceQualityScore: options.surfaceQualityScore ?? 0.87,
    staleScore: options.staleScore ?? 0.22,
    lastUpdatedAt: options.lastUpdatedAt ?? Date.now(),
  };
}

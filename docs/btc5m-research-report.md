# BTC 5m Research Report

Generated: 2026-05-13

## Current Result

The first research pipeline run did not find a profitable strategy candidate.

This is not a negative strategy result yet. The limiting factor is data coverage: Polymarket Gamma market metadata and CLOB current books are available, but historical `prices-history` coverage for the sampled recent BTC 5m markets was sparse, and historical full orderbook depth was not available from the public probes.

## Data Run

Commands exercised:

```bash
pnpm --filter @vol-arb/api btc5m:research probe
pnpm --filter @vol-arb/api btc5m:research collect-markets --days 7 --limit 240 --throttle-ms 25 --timeout-ms 2000 --progress-every 50
pnpm --filter @vol-arb/api btc5m:research collect-price-history --days 7 --limit-markets 30 --throttle-ms 25 --fidelity-seconds 60 --timeout-ms 2500 --progress-every 20
pnpm --filter @vol-arb/api btc5m:research genetic --days 7 --limit-markets 240 --generations 2 --population 6 --validation-fraction 0.2857 --persist-best
pnpm --filter @vol-arb/api btc5m:research coverage --days 7
```

Observed:

- Market metadata: `240/240` sampled markets stored successfully.
- Price history sample: `4` points from `30` markets in that run.
- Genetic search input: `26` stored `clob_prices_history` points available across the sampled DB set.
- Genetic search result: `0` trades, `0` PnL.
- Genetic search now reports train and holdout validation separately; a candidate is not accepted unless validation has enough trades, positive PnL, and acceptable drawdown.

Additional forward collection run:

- Live collector: 120 seconds, `228` snapshots, `0` errors.
- Live collector: 300 seconds, `586` snapshots, `0` errors.
- Coverage after collection: `820` executable points, still below the current threshold of `7452`.
- Latest GA on recent data used `1477` points from markets with data:
  - train: `4` markets, `1201` points, `1` trade, positive PnL in-sample.
  - validation: `1` market, `276` points, `0` trades.
  - accepted: `false`.

The in-sample trade is not considered a strategy candidate because validation produced no trades and the sample is too small.

## Interpretation

No trade was selected because the historical price path was too sparse to verify limit-order entry and limit-order exit rules. The backtester correctly refused to infer fills from missing data.

This is preferable to a false-positive backtest. The system currently requires observable price/book evidence before it records a fill.

The `coverage` command should be used before larger GA runs. It reports executable evidence from orderbook snapshots and trades, plus Beijing time segment coverage.

## Implemented Controls

- Initial capital: `100 USDC`.
- Max risk per trade: `10%` of current equity.
- Limit orders only.
- Early exit uses limit sells only.
- Optional hold-to-settlement fallback.
- Beijing weekday/day, weekday/night, weekend/day, weekend/night segmentation.
- Hard risk controls:
  - max daily loss,
  - max drawdown stop,
  - max consecutive loss stop,
  - single-market exposure default.
- Optional fractional Kelly sizing, always clipped by hard risk limits.

## Next Data Requirement

To actually evaluate whether a profitable strategy exists, the project needs denser historical or forward-collected data:

1. Run the live orderbook snapshot collector continuously at 1-second cadence.
2. Collect authenticated CLOB trade pages for each BTC 5m token.
3. Continue saving auxiliary BTC spot prices.
4. Re-run GA after enough `orderbook_snapshot` and trade data exists.

Suggested forward collector schedule:

```bash
pnpm --filter @vol-arb/api btc5m:research collect-orderbook-live --duration-seconds 3600 --interval-ms 1000 --progress-every 30
```

For longer operation, run repeated one-hour sessions under a process manager with log rotation.

## Current Conclusion

The research infrastructure is now in place, including genetic search. The first limited historical run did not produce a candidate strategy because available historical executable-price data was insufficient. The next meaningful step is to collect real 1-second orderbook snapshots for several market sessions, especially segmented by Beijing daytime/nighttime and weekday/weekend.

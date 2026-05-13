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
- Live observer: 600 seconds, `1170` snapshots, `586` paper signals, `312` would-enter paper signals, `0` errors.
- Coverage after live observer: `1998` executable points, still below the threshold of `7452`.
- Paper signal evaluation after refreshing recent results:
  - evaluated: `133` would-enter signals.
  - total PnL if held to settlement: `-1329.9854`.
  - win rate: `0`.
  - interpretation: the default paper signal parameters are not acceptable and should not be traded.
- Paper signal attribution now supports rechecking the same signals with limit-only exits from
  subsequent orderbook snapshots before falling back to settlement.
- Rechecking with limit-only exits did not rescue the default strategy:
  - evaluated: `251` would-enter signals.
  - limit exits: `235`; settlement exits: `16`.
  - total PnL: `-1219.97765`.
  - win rate: `0.007968`.
  - exit attribution: `233` stop-loss exits, `2` take-profit exits, `16` settlement exits.
- Paper signal summary now blocks strategies with enough settled negative paper evidence:
  - `lottery_reprice` is blocked by `251` settled signals, `-1219.97765` PnL, `0.007968` win rate.
- GA now includes paper-signal summary in its output, cannot accept a strategy blocked by
  settled paper evidence, and excludes blocked strategies from the search pool.
- Auxiliary BTC 1m data was collected for baseline volatility:
  - Binance was unavailable from the current network.
  - Coinbase stored `9645` 1m close ticks.
  - these ticks are used only as auxiliary baseline inputs, not as Polymarket settlement truth.
- `probability_cone` now uses BTC open price, current price, remaining time, and rolling
  volatility to estimate baseline UP probability before comparing against contract prices.
- Polymarket Data API market trades are now collected through `/trades?market=<conditionId>`.
  The earlier authenticated CLOB `/data/trades` path is account-scoped and returned no useful
  market history for this research task.
- After collecting one Data API page for 20 recent BTC 5m markets:
  - stored trade rows visible in 7-day coverage: `8136`.
  - executable points: `10134` vs required `7428`.
  - `readyForGeneticSearch: true`.
- Latest small GA run:
  - dataset: `11745` points, including `trade_proxy`.
  - best train candidate: `probability_cone`, `8` trades, `27.1715` PnL.
  - validation: `6` trades, `-14.3451` PnL.
  - accepted: `false`.
- Limit-entry fill modeling was tightened after the Data API trade integration:
  - a paper/backtest buy now requires subsequent market data to touch the entry limit
    within `entryMaxWaitSeconds`; otherwise the entry is treated as unfilled.
  - after this stricter fill model, the best small GA run no longer showed in-sample profit:
    train `6` trades, `-0.5164` PnL; validation `4` trades, `-0.1357` PnL.
  - accepted: `false`.
- Larger GA search after stricter limit-entry fills (`20` generations, `32` population):
  - train: `9` trades, `21.1613` PnL.
  - validation: `4` trades, `-1.9850` PnL.
  - accepted: `false`.
  - interpretation: the search can overfit rare low-price rebounds in train data; validation
    still rejects the candidate.
- The acceptance gate now requires at least `8` validation trades, positive validation PnL,
  acceptable drawdown, and no paper-signal block.
- Data API trade collection now supports `--stride`, allowing sparse sampling across the
  full 7-day window instead of only the most recent contiguous markets.
- After collecting one page for `80` recent markets and `120` stride-sampled markets:
  - stored trade rows visible in 7-day coverage: `78116`.
  - executable points: `80114` vs required `7416`.
  - trade segment coverage: `weekday_beijing_day=12080`, `weekday_beijing_night=44283`,
    `weekend_beijing_day=8435`, `weekend_beijing_night=13318`.
- GA after stride-sampled trade coverage (`12` generations, `24` population):
  - dataset: `81725` points.
  - train: `9` trades, `17.0726` PnL.
  - validation: `13` trades, `-12.5526` PnL.
  - accepted: `false`.
  - interpretation: wider trade coverage increases validation sample size, but the current
    probability-cone/low-price rebound family still fails out-of-sample.
- GA now includes `targetSegment` in the search space so candidates can choose `all`,
  `weekday_beijing_day`, `weekday_beijing_night`, `weekend_beijing_day`, or
  `weekend_beijing_night`.
- Latest segmented GA run:
  - dataset: `81725` points.
  - best train candidate: `probability_cone` targeting `weekday_beijing_night`.
  - train: `5` trades, `2.2608` PnL.
  - validation: `6` trades, `-16.6145` PnL.
  - accepted: `false`.
  - interpretation: time-segment gating alone did not fix the overfitting problem. The
    optimizer still found weak in-sample behavior that failed validation, and several
    non-night segment candidates produced no selected trades under the current strategy
    family.
- Backtests now carry Data API trade `size` into `trade_proxy` points, and GA can search
  `minRecentTradeVolume` plus `tradeVolumeLookbackSeconds` as a pre-entry liquidity filter.
- First GA run after adding recent trade-volume filtering:
  - dataset: `81725` points.
  - best train candidate: `probability_cone` targeting `weekday_beijing_night`.
  - train: `10` trades, `44.2242` PnL.
  - validation: `6` trades, `-19.8199` PnL.
  - accepted: `false`.
  - interpretation: the best candidate reverted to `minRecentTradeVolume=0`, so this
    filter did not improve the current probability-cone family by itself.
- Market metadata was refreshed across the full 7-day window:
  - requested markets: `2016`.
  - stored: `2015`.
  - errors: `1` aborted request.
  - resolved markets in the 7-day window increased from `78` to `2012`.
- Coverage after the full metadata refresh:
  - markets: `2012`; resolved markets: `2012`.
  - price points: `25`; orderbook snapshots: `1998`; trades: `78116`; BTC ticks: `9598`.
  - executable points: `80114` vs required `12072`.
  - `readyForGeneticSearch: true`.
- Coverage now reports market-level execution quality in addition to raw point count.
  Latest diagnostic:
  - markets: `2011`; resolved markets: `2010`.
  - markets with trades: `190` (`9.45%`).
  - markets with orderbook snapshots: `9` (`0.45%`).
  - execution quality: `insufficient`.
  - warning: historical orderbook snapshot coverage is sparse, and trade history covers
    less than half of recent markets.
  - interpretation: GA can run, but output must be treated as research-only until forward
    orderbook coverage improves materially.
- Short forward orderbook collector smoke test:
  - command: `collect-orderbook-live --duration-seconds 60 --interval-ms 1000 --max-snapshots 240 --progress-every 15`.
  - result: `55` iterations, `109` snapshots, `1` aborted UP book request.
  - coverage impact: orderbook snapshots increased to `2107`, markets with orderbook
    snapshots increased from `8` to `9`.
  - interpretation: the collector works, but one minute only adds one active market. Robust
    execution testing requires collection across many 5-minute markets and multiple Beijing
    day/night plus weekday/weekend sessions.
- Train/validation splitting now uses a time-ordered split inside each Beijing segment,
  instead of a single global time split. This avoids accepting a candidate that only trades
  a segment present in train but absent from validation.
- First GA run after segment-stratified validation:
  - dataset: `81725` points.
  - best train candidate: `probability_cone`, `targetSegment=all`.
  - key parameters: `entryMaxPrice=0.0347`, `takeProfitMultiple=1.8870`,
    `stopLossFraction=0.95`, `probabilityEdge=0.1234`,
    `minRecentTradeVolume=133.2102`, `tradeVolumeLookbackSeconds=78`.
  - train: `24` trades, `23.3239` PnL, `6.0361` max drawdown.
  - validation: `8` trades, `7.6932` PnL, `2.6812` max drawdown.
  - validation segment breakdown: `weekend_beijing_day=2` trades / `8.3254` PnL,
    `weekday_beijing_day=3` trades / `-1.6168` PnL,
    `weekday_beijing_night=3` trades / `0.9846` PnL.
  - accepted by the current research gate: `true`.
  - interpretation: this is the first candidate worth stricter follow-up. It is not yet a
    live-trading approval because most executable evidence comes from `trade_proxy`
    market trades rather than full historical orderbook depth.
- A stress-validation gate was added after this first accepted research candidate. It
  reruns the best train parameters on validation with wider assumed spread, longer
  decision delay, shorter entry-fill window, higher probability edge, and higher recent
  trade-volume requirement.
- First GA run after adding stress validation:
  - dataset: `81725` points.
  - best train candidate: `probability_cone` targeting `weekend_beijing_night`.
  - train: `9` trades, `10.5647` PnL.
  - validation: `0` trades, `0` PnL.
  - stress validation: `0` trades, `0` PnL.
  - accepted by the stricter gate: `false`.
  - interpretation: the earlier positive validation is a research lead, not a robust
    strategy. The current search space still needs stricter executable-liquidity modeling
    and repeated walk-forward confirmation before any live/paper trading integration.
- Genetic search now supports `--seed <integer>` and returns `seed` in the result. Seeded
  runs use a deterministic internal random generator, which makes GA experiments
  reproducible when the underlying database snapshot is unchanged.
- Reproducibility check:
  - command: `genetic --days 7 --limit-markets 2016 --generations 3 --population 8 --validation-fraction 0.2857 --seed 123`.
  - two runs matched exactly after ignoring timestamp-derived `runId` fields.
  - result: train `14` trades / `-0.0548` PnL; validation `3` trades / `-2.6093` PnL;
    stress validation `3` trades / `-3.2767` PnL; accepted `false`.
- GA acceptance now includes an explicit coverage gate:
  - `accepted` requires `coverageAccepted=true`.
  - `coverageAccepted` is true only when execution quality is `partial_orderbook` or
    `orderbook_backtest_ready`.
  - latest smoke check with `--seed 7`: `executionQuality=insufficient`,
    `coverageAccepted=false`, `accepted=false`.
- Latest coverage:
  - markets: `2012`; resolved markets: `2012`.
  - price points: `25`; orderbook snapshots: `1998`; trades: `78116`; BTC ticks: `9598`.
  - executable points: `80114` vs required `12072`.
- GA after live observer used `3585` points:
  - train: `7` markets, `2307` points, `0` selected trades for the best train candidate.
  - validation: `2` markets, `1278` points, `0` trades.
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
- Optional strategy targeting of one Beijing segment during GA search.
- Optional recent same-outcome trade-volume filtering before entry.
- Segment-stratified train/validation splitting.
- Hard risk controls:
  - max daily loss,
  - max drawdown stop,
  - max consecutive loss stop,
  - single-market exposure default.
- Optional fractional Kelly sizing, always clipped by hard risk limits.

## Next Data Requirement

To actually evaluate whether a profitable strategy exists, the project needs denser historical or forward-collected data:

1. Run the live orderbook snapshot collector at 1-second cadence across multiple sessions
   until `orderbookMarketCoverage` reaches at least `10%` (`partial_orderbook`) and then
   preferably `50%` (`orderbook_backtest_ready`).
2. Collect Data API trade pages across more BTC 5m markets until `tradeMarketCoverage`
   reaches at least `50%`.
3. Continue saving auxiliary BTC spot prices.
4. Re-run seeded GA after enough `orderbook_snapshot` and trade data exists, then require
   ordinary validation and stress validation to pass.

Suggested forward collector schedule:

```bash
pnpm --filter @vol-arb/api btc5m:research collect-orderbook-live --duration-seconds 3600 --interval-ms 1000 --progress-every 30
```

For longer operation, run repeated one-hour sessions under a process manager with log rotation.

## Current Conclusion

The research infrastructure is now in place, including genetic search. The first limited historical run did not produce a candidate strategy because available historical executable-price data was insufficient. The next meaningful step is to collect real 1-second orderbook snapshots for several market sessions, especially segmented by Beijing daytime/nighttime and weekday/weekend.

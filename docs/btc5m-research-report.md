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
- GA output now includes `acceptanceRequirements` and machine-readable
  `acceptanceBlockers`, so downstream automation can distinguish data insufficiency from
  validation failure, stress failure, and negative paper-signal evidence.
- GA acceptance now also requires at least `500` markets in the dataset, preventing small
  smoke checks from being interpreted as live-ready strategy evidence.
- GA acceptance now includes walk-forward validation across sequential market windows.
  A candidate must have enough windows, positive aggregate walk-forward PnL, and more
  profitable windows than losing windows before it can be considered live-ready.
- Current full 7-day GA smoke check after adding acceptance blockers:
  - command: `genetic --days 7 --limit-markets 2016 --generations 2 --population 8 --seed 11`.
  - dataset: `2007` markets, `651716` points, `1531` markets with trades, `20` markets
    with orderbook snapshots.
  - execution quality: `trade_proxy_only`, still below `partial_orderbook`.
  - best train candidate: `probability_cone`, target segment `weekday_beijing_day`,
    train PnL `5.9599931015` across `10` trades.
  - validation: `6` trades, `-14.4422438280` PnL, `0` win rate.
  - stress validation: `6` trades, `-14.4421666640` PnL.
  - walk-forward validation: `4` windows, `16` trades, `-2.5580953689` aggregate PnL,
    `1` profitable window and `3` losing windows.
  - acceptance blockers: validation trade count below minimum, validation PnL not
    positive, stress PnL not positive, walk-forward PnL not positive, walk-forward
    profitable windows not dominant, and execution quality below `partial_orderbook`.
  - interpretation: the current search can still find small in-sample wins, but the
    candidate is rejected on out-of-sample behavior and on insufficient real orderbook
    execution evidence.
- GA search space now includes `allowHoldToSettlement` and `forceExitBeforeEndSeconds`,
  so it can compare candidates that allow settlement against candidates that require an
  earlier limit-order exit.
- `genetic-sweep` now reports aggregate blocker counts, strategy counts, target segment
  counts, best validation run, and best walk-forward run across seeds.
- `genetic-sweep` can now persist a full local JSON artifact with `--save-report` or
  `--report-file`, making multi-seed experiments reproducible without copying stdout.
- Added `longshot_cone`, a convex payout strategy family that uses probability-cone
  estimates but selects by relative expected return (`probability / price - 1`) instead
  of absolute probability edge.
- Backtest and GA reports now include additional risk/performance metrics: return on
  capital, drawdown fraction, gross profit, gross loss, profit factor, and average trade
  PnL.
- Stop-loss backtest fills are now more conservative: when a stop is crossed, the model
  exits with a limit sell at the observed bid instead of assuming a guaranteed fill at the
  original stop price.
- Backtest fills now enforce observed size for `trade_proxy` and `orderbook_snapshot`
  points when size data is present, so a strategy cannot assume a larger fill than visible
  liquidity.
- `orderbook_snapshot` points now keep bid/ask side information. Candidate selection and
  entries use asks, while exits use bids, preventing bid prices from being treated as
  executable entry asks.
- GA acceptance now checks orderbook coverage by Beijing regime. Targeted strategies need
  `partial_orderbook` coverage in their selected segment, and `targetSegment=all`
  strategies need at least 3 Beijing regimes with `partial_orderbook` coverage.
- Added `pnpm btc5m:orderbook:start:auto`, which inspects current coverage and starts a
  background collector targeting the weakest orderbook segments by default.
- Latest 3-seed full-window sweep after adding `longshot_cone`:
  - command: `genetic-sweep --days 7 --limit-markets 2016 --seeds 3 --seed-start 41 --generations 2 --population 9`.
  - accepted count: `0`.
  - execution quality: `trade_proxy_only`.
  - blocker counts: validation PnL not positive `2/3`, stress PnL not positive `3/3`,
    walk-forward PnL not positive `3/3`, walk-forward profitable windows not dominant
    `3/3`, execution quality below `partial_orderbook` `3/3`.
  - strategy counts: `probability_cone=2`, `longshot_cone=1`.
  - best validation run: seed `43`, `probability_cone`, `weekend_beijing_night`,
    validation PnL `4.7082955973`, `24` trades, win rate `0.291667`.
  - same seed failed walk-forward: `-13.6100481018` PnL, `15` trades, `0` profitable
    windows and `2` losing windows.
  - interpretation: a single holdout slice can look profitable, but the broader
    walk-forward test still rejects the current candidate family.
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
- Added `collect-orderbook-sessions` for resumable forward collection across repeated
  short sessions. Smoke test:
  - command: `collect-orderbook-sessions --sessions 2 --duration-seconds 20 --interval-ms 1000 --pause-seconds 1 --progress-every 10`.
  - result: `2` sessions completed, `80` snapshots, `0` errors.
  - orderbook market coverage after smoke test: `0.50%`.
- First longer segmented orderbook collection run:
  - command: `collect-orderbook-sessions --sessions 3 --duration-seconds 300 --interval-ms 1000 --pause-seconds 2 --progress-every 60`.
  - result: `3` sessions completed, `1800` snapshots, `0` errors.
  - latest orderbook snapshots: `3987`.
  - markets with orderbook snapshots: `13/2007`.
  - latest orderbook market coverage: `0.65%`.
  - interpretation: collection is stable, but at 5-minute market cadence reaching
    `partial_orderbook` (`10%`) requires many hours across different Beijing sessions.
- Coverage now includes orderbook target estimates:
  - `partial_orderbook` target: `201` markets.
  - current markets with orderbook: `13`.
  - remaining markets until `partial_orderbook`: `188`.
  - estimated continuous collection time until `partial_orderbook`: `15.7` hours.
  - `orderbook_backtest_ready` target: `1003` markets.
  - estimated continuous collection time until `orderbook_backtest_ready`: `82.5` hours.
- Coverage now reports `segmentMarketCoverage`.
  Latest segment market coverage:
  - `weekday_beijing_day`: `599` markets, `374` with trades, `0` with orderbook.
  - `weekday_beijing_night`: `832` markets, `581` with trades, `15` with orderbook.
  - `weekend_beijing_day`: `240` markets, `240` with trades, `0` with orderbook.
  - `weekend_beijing_night`: `336` markets, `336` with trades, `0` with orderbook.
  - interpretation: current orderbook evidence is concentrated in Beijing weekday night.
    Future forward collection must deliberately cover Beijing daytime and weekend sessions.
- Segment coverage now includes segment-level `partial_orderbook` and
  `orderbook_backtest_ready` targets, remaining markets, and estimated continuous
  collection hours. This prevents the global coverage target from hiding a missing
  Beijing day/night or weekday/weekend regime.
- Coverage now reports `weakestOrderbookSegments`; current weakest segments are
  `weekday_beijing_day` and `weekend_beijing_night`, both with `0` markets covered by
  orderbook snapshots.
- Coverage now reports `collectionRecommendation`. Current segment is
  `weekday_beijing_night` with `16/832` orderbook-covered markets; recommendation is to
  keep background collection running but prioritize future collection during
  `weekday_beijing_day` and `weekend_beijing_night`.
- Coverage now reports `nextWeakSegmentWindows`; current next priority windows are:
  - `weekday_beijing_day`: Beijing `2026-05-14 08:00:00` to `2026-05-14 18:00:00`.
  - `weekend_beijing_night`: Beijing `2026-05-16 00:00:00` to `2026-05-16 08:00:00`.
- `collect-orderbook-sessions` now supports `--target-segments` and
  `--wait-for-target-segment`, and the background collector launcher can pass these via
  `BTC5M_ORDERBOOK_TARGET_SEGMENTS`. This allows future collection runs to wait for and
  capture missing Beijing day/night or weekday/weekend regimes instead of over-sampling
  the current segment.
- Added background orderbook collector helpers:
  - `pnpm btc5m:orderbook:start`
  - `pnpm btc5m:orderbook:collector`
  - `pnpm btc5m:orderbook:stop`
  - status check verified `not_running`, with PID file under `.local/run` and logs under
    `.local/logs`.
- New background collector starts use `caffeinate -dimsu` on macOS by default to reduce
  sleep risk during long collection. Set `BTC5M_ORDERBOOK_CAFFEINATE=false` to disable it.
- Background collector status now distinguishes `configuredCaffeinate` from
  `launchCaffeinate` and writes launch metadata to `.local/run`. The currently running
  collector was started before metadata existed, so `launchCaffeinate=null` until restart.
- The background collector was restarted after adding launch metadata and macOS sleep
  prevention:
  - new PID: `38702`.
  - `launchCaffeinate=true`.
  - launch command uses `caffeinate -dimsu pnpm ...`.
  - old collector PID `35971` was stopped before the restart.
- Trade coverage was expanded with additional Data API collection:
  - `collect-trades --days 7 --limit-markets 400 --pages-per-market 1 --stride 3`
    stored `200000` fetched trade rows with `0` errors.
  - `collect-trades --days 7 --limit-markets 600 --pages-per-market 1 --stride 2`
    stored `300000` fetched trade rows with `0` errors.
  - `collect-trades --days 7 --limit-markets 1500 --pages-per-market 1 --missing-only`
    targeted `566` markets missing trades and fetched `282549` rows with `0` errors.
  - latest trade market coverage: `1531/2007` markets, `76.28%`.
  - latest execution quality: `trade_proxy_only`.
  - latest status smoke check: `tradeMarketCoverage=0.7632`,
    `orderbookMarketCoverage=0.0045`, `coverageAccepted=false`, `gaAccepted=false`.
  - interpretation: historical trade coverage is now broad enough for research, but
    real orderbook coverage remains the gating weakness for live-quality acceptance.
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
- Added `genetic-sweep` to summarize multiple seeded GA runs. Smoke check:
  - command: `genetic-sweep --days 7 --seeds 2 --seed-start 1 --generations 1 --population 4`.
  - result: `acceptedCount=0`, `executionQualities=["trade_proxy_only"]`.
  - seed `1`: validation `4` trades / `-22.1549` PnL; stress validation `4` trades /
    `-22.3840` PnL.
  - seed `2`: validation `6` trades / `-15.4268` PnL; stress validation `6` trades /
    `-16.7194` PnL.
- GA acceptance now includes an explicit coverage gate:
  - `accepted` requires `coverageAccepted=true`.
  - `coverageAccepted` is true only when execution quality is `partial_orderbook` or
    `orderbook_backtest_ready`.
  - latest smoke check with `--seed 7`: `executionQuality=insufficient`,
    `coverageAccepted=false`, `accepted=false`.
- Added `btc5m:research status` as a compact gate report. With `--with-ga`, it runs
  coverage, paper summary, and a small seeded GA smoke check in one command.
  Latest status smoke check returned `executionQuality=insufficient`,
  `gaAccepted=false`, `coverageAccepted=false`, and blocked `lottery_reprice` from
  paper evidence.
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

# BTC 5m Research Pipeline

This pipeline researches Polymarket `BTC Up or Down 5m` strategies without live trading.

## Scope

- Window: most recent 7 days by default.
- Starting simulation capital: `100 USDC`.
- Max risk per trade: `10%` of current equity.
- Hard risk controls: daily loss limit, max drawdown stop, consecutive-loss stop, and single-market exposure by default.
- Optional fractional Kelly sizing may reduce position size, but hard risk limits always cap Kelly output.
- Order model: limit orders only.
- Entry: limit buy.
- Exit: limit sell, settlement only when the strategy allows holding to resolution.
- Live trading: disabled; this is data collection, backtesting, and strategy search only.

## Data Sources

- Gamma API: resolves `btc-updown-5m-{epoch}` markets, UP/DOWN token ids, time windows, and resolution metadata.
- CLOB `/book`: current live orderbook snapshots for current markets.
- CLOB `/prices-history`: historical token price points. This is stored as `clob_prices_history` and treated as a proxy when full historical book depth is unavailable.
- Binance BTCUSDT 1m klines and Coinbase BTC-USD 1m candles: auxiliary spot feature data, not Polymarket settlement truth. The CLI tries Binance first and falls back to Coinbase.

Historical full orderbook snapshots are not assumed to be available. The collector stores live snapshots from now forward so future backtests can use real book data where present.

## Commands

Probe data source availability:

```bash
pnpm --filter @vol-arb/api btc5m:research probe
```

Collect market metadata:

```bash
pnpm --filter @vol-arb/api btc5m:research collect-markets --days 7 --limit 2016 --throttle-ms 100
```

Collect CLOB price history:

```bash
pnpm --filter @vol-arb/api btc5m:research collect-price-history --days 7 --limit-markets 2016 --fidelity-seconds 60 --throttle-ms 100
```

Collect Polymarket Data API market trades:

```bash
pnpm --filter @vol-arb/api btc5m:research collect-trades --days 7 --limit-markets 2016 --pages-per-market 2 --stride 1 --throttle-ms 100
```

Use `--stride` greater than `1` to sample across the full time window instead of only the
most recent contiguous markets.

Use `--missing-only` after an initial collection pass to skip markets that already have
stored trades:

```bash
pnpm --filter @vol-arb/api btc5m:research collect-trades --days 7 --limit-markets 1500 --pages-per-market 1 --missing-only --throttle-ms 25
```

Collect auxiliary BTC spot:

```bash
pnpm --filter @vol-arb/api btc5m:research collect-btc-price --days 7 --throttle-ms 200
```

Take one live orderbook snapshot:

```bash
pnpm --filter @vol-arb/api btc5m:research snapshot-orderbook
```

Run a managed live orderbook collector:

```bash
pnpm --filter @vol-arb/api btc5m:research collect-orderbook-live --duration-seconds 3600 --interval-ms 1000 --progress-every 30
```

Run repeated short collector sessions with a coverage report at the end:

```bash
pnpm --filter @vol-arb/api btc5m:research collect-orderbook-sessions --sessions 12 --duration-seconds 300 --interval-ms 1000 --pause-seconds 5 --progress-every 60
```

Restrict collection to specific Beijing segments when coverage is unbalanced:

```bash
pnpm --filter @vol-arb/api btc5m:research collect-orderbook-sessions --sessions 12 --duration-seconds 300 --target-segments weekday_beijing_day,weekend_beijing_night --wait-for-target-segment
```

Run the segmented collector in the background:

```bash
pnpm btc5m:orderbook:start
pnpm btc5m:orderbook:start:auto
pnpm btc5m:orderbook:collector
pnpm btc5m:orderbook:stop
```

The background collector writes its PID to `.local/run/btc5m-orderbook-collector.pid`
and logs to `.local/logs/btc5m-orderbook-collector.log`. Defaults are intentionally long
enough to target roughly 16 hours of forward collection; override them with
`BTC5M_ORDERBOOK_SESSIONS`, `BTC5M_ORDERBOOK_DURATION_SECONDS`,
`BTC5M_ORDERBOOK_INTERVAL_MS`, `BTC5M_ORDERBOOK_PAUSE_SECONDS`, and
`BTC5M_ORDERBOOK_PROGRESS_EVERY`.

Set `BTC5M_ORDERBOOK_TARGET_SEGMENTS` to a comma-separated list such as
`weekday_beijing_day,weekend_beijing_night` to start a background collector that only
captures those regimes. When target segments are configured, the launcher adds
`--wait-for-target-segment` by default, so it waits instead of exiting if the current
Beijing segment is not yet in the target list. Set
`BTC5M_ORDERBOOK_WAIT_FOR_TARGET_SEGMENT=false` to disable waiting.

Use `pnpm btc5m:orderbook:start:auto` to inspect current coverage first and automatically
target the weakest orderbook segments. `BTC5M_ORDERBOOK_AUTO_TARGET_COUNT` controls how
many weak segments are targeted; the default is `2`.

On macOS, new background collector starts are wrapped with `caffeinate -dimsu` by default
to reduce sleep risk during long collection. Set `BTC5M_ORDERBOOK_CAFFEINATE=false` to
disable that wrapper. Status reports both `configuredCaffeinate` and `launchCaffeinate`;
if an older collector was started before launch metadata existed, `launchCaffeinate` may be
`null` until the collector is restarted.

Run live observation, which captures orderbook snapshots and persists paper signals after each iteration:

```bash
pnpm --filter @vol-arb/api btc5m:research observe-live --duration-seconds 3600 --interval-ms 1000 --progress-every 30
```

Check whether the dataset is dense enough for executable limit-order backtests:

```bash
pnpm --filter @vol-arb/api btc5m:research coverage --days 7
```

Coverage reports both point count and market-level execution quality. `readyForGeneticSearch`
only means there are enough executable points to run the GA. A strategy should not be
treated as robust unless `executionQuality` is at least `partial_orderbook`, because
`trade_proxy_only`, `thin_trade_proxy`, and `insufficient` indicate sparse historical
orderbook evidence.

Coverage also reports `orderbookTargets`, including how many additional 5-minute markets
must be forward-collected to reach `partial_orderbook` (`10%`) and
`orderbook_backtest_ready` (`50%`), plus an approximate continuous collection time.

Use `segmentMarketCoverage` to check whether coverage is balanced across
`weekday_beijing_day`, `weekday_beijing_night`, `weekend_beijing_day`, and
`weekend_beijing_night`. A global orderbook percentage is not enough if all snapshots come
from only one segment.

Each segment coverage row also reports the segment-level orderbook targets, including the
number of additional markets and approximate continuous collection hours needed for that
segment to reach `partial_orderbook` (`10%`) and `orderbook_backtest_ready` (`50%`).

Coverage also reports `collectionRecommendation`, which compares the current Beijing
segment against the weakest orderbook segments and tells whether current collection should
continue or future collection should be prioritized in another segment.

`nextWeakSegmentWindows` lists the next Beijing-time windows for the weakest orderbook
segments, so long-running collection can be scheduled around the missing sessions instead
of blindly collecting only the current regime.

Run a compact research status report:

```bash
pnpm --filter @vol-arb/api btc5m:research status --days 7
```

Include a small seeded GA smoke check when needed:

```bash
pnpm --filter @vol-arb/api btc5m:research status --days 7 --with-ga --generations 1 --population 4 --seed 7
```

Record a real-time paper signal without submitting any order:

```bash
pnpm --filter @vol-arb/api btc5m:research paper-signal --persist
```

Evaluate paper signals. This first checks subsequent orderbook snapshots for limit-only exits
(`take_profit_limit`, `stop_loss_limit`, `time_exit_limit`), then falls back to settlement
when no earlier exit is observed:

```bash
pnpm --filter @vol-arb/api btc5m:research evaluate-paper-signals --limit 200
```

Re-attribute previously evaluated signals with the same limit-exit rules:

```bash
pnpm --filter @vol-arb/api btc5m:research evaluate-paper-signals --limit 200 --recheck-settled
```

Summarize settled paper signals by strategy and Beijing segment:

```bash
pnpm --filter @vol-arb/api btc5m:research paper-summary
```

Run a backtest:

```bash
pnpm --filter @vol-arb/api btc5m:research backtest --days 7 --limit-markets 2016 --persist
```

Run genetic strategy search:

```bash
pnpm --filter @vol-arb/api btc5m:research genetic --days 7 --limit-markets 2016 --generations 6 --population 12 --validation-fraction 0.2857 --seed 42 --persist-best
```

Run a multi-seed GA sweep:

```bash
pnpm --filter @vol-arb/api btc5m:research genetic-sweep --days 7 --seeds 5 --seed-start 1 --generations 6 --population 12
```

The sweep output includes aggregate `blockerCounts`, `strategyCounts`,
`targetSegmentCounts`, `bestValidationRun`, and `bestWalkForwardRun` so repeated seeds can
be compared without manually reading every full run.

Add `--save-report` to write the full sweep JSON under `.local/reports`, or pass
`--report-file <path>` for an explicit local artifact:

```bash
pnpm --filter @vol-arb/api btc5m:research genetic-sweep --days 7 --seeds 5 --seed-start 1 --generations 6 --population 12 --save-report
```

## Resource Controls

Defaults are intentionally conservative:

- Collectors run in a single process.
- API calls are throttled by CLI options.
- Backtests read data in market batches.
- Genetic search defaults to 6 generations and 12 candidates.
- Search scoring penalizes drawdown and ignores tiny-sample candidates.
- Pass `--seed` for reproducible genetic search experiments.

Increase limits only after the first reports are inspected.

## Strategy Model

The first implemented strategies are:

- `lottery_reprice`: looks for cheap UP/DOWN contracts and exits with limit sells when the market reprices.
- `probability_cone`: builds a baseline UP probability from auxiliary BTC open price,
  current price, remaining time, and rolling volatility, then compares that baseline
  against the UP/DOWN contract prices.
- `longshot_cone`: uses the same probability cone, but ranks candidates by relative
  expected return (`probability / price - 1`) to test low-priced convex payout setups.

Both strategies support:

- dynamic position sizing from current equity,
- limit-only entry,
- limit-entry fill verification from subsequent market data within `entryMaxWaitSeconds`,
- observed size checks for `trade_proxy` and `orderbook_snapshot` fills when size data is
  available,
- bid/ask side separation for `orderbook_snapshot`: entries and candidate prices use asks,
  exits use bids,
- optional recent same-outcome trade-volume filtering before entry,
- take-profit limit exit,
- stop-loss limit exit,
- time-based limit exit,
- optional hold-to-settlement fallback,
- decision delay,
- assumed spread for price-history proxy data.
- Beijing day/night and weekday/weekend segment reporting.
- trader-style risk stops before new entries, including max daily trades.

Backtest reports include gross profit, gross loss, profit factor, average trade PnL,
return on capital, and drawdown fraction in addition to total PnL and win rate.

Stop-loss exits are conservative: after the stop is crossed, the model exits with a limit
sell at the observed bid, not with a guaranteed fill at the original stop price.

## Genetic Algorithm

The genetic search reads the dataset once, then performs a time-ordered train/validation
split inside each Beijing segment. This keeps weekday daytime, weekday nighttime,
weekend daytime, and weekend nighttime markets represented in validation when enough
markets exist. With the default 7-day window, the validation fraction is `2/7`.

Use `--seed <integer>` when comparing strategy changes. Seeded runs use a deterministic
internal random generator, so the same dataset and same search settings produce the same
candidate sequence.

Use `genetic-sweep` to check whether results are stable across multiple seeds. A single
profitable seed is not enough evidence for a strategy candidate.

The genetic search mutates these parameters:

- `entryMaxPrice`
- `takeProfitMultiple`
- `stopLossFraction`
- `maxHoldSeconds`
- `forceExitBeforeEndSeconds`
- `minSecondsRemaining`
- `maxSecondsRemaining`
- `probabilityEdge`
- `assumedSpread`
- `decisionDelaySeconds`
- `entryMaxWaitSeconds`
- `maxDailyTrades`
- `kellyFraction`
- `coneVolatilityMultiplier`
- `minRecentTradeVolume`
- `tradeVolumeLookbackSeconds`
- `useKellySizing`
- `allowHoldToSettlement`
- `targetSegment`: `all`, `weekday_beijing_day`, `weekday_beijing_night`,
  `weekend_beijing_day`, or `weekend_beijing_night`

Fitness is:

```text
totalPnl - maxDrawdown * 0.35 + winRate * 2
```

Candidates with fewer than 8 train trades are heavily penalized, and validation acceptance
requires at least 8 validation trades, positive PnL, acceptable drawdown, and a positive
stress validation. Final `accepted` also requires `executionQuality` to be
`partial_orderbook` or `orderbook_backtest_ready`; a run based on `trade_proxy_only`,
`thin_trade_proxy`, or `insufficient` evidence remains research-only even if PnL gates pass.
Acceptance also requires at least 500 markets in the GA dataset, so small smoke runs cannot
be mistaken for production-ready evidence.

Execution coverage is also checked by Beijing regime. If `targetSegment` is a specific
segment, that segment must reach `partial_orderbook`. If `targetSegment=all`, at least 3
Beijing regimes must reach `partial_orderbook`, so one over-sampled regime cannot make an
all-regime strategy look production-ready.

Stress validation reruns the best train parameters on the validation slice with:

- `assumedSpread` increased by `0.01`,
- `decisionDelaySeconds` increased by `2`,
- `entryMaxWaitSeconds` cut in half,
- `probabilityEdge` increased by `0.02`,
- `minRecentTradeVolume` increased by `25%` when enabled.

Walk-forward validation also reruns the best train parameters across sequential market
windows. Acceptance requires at least 3 walk-forward windows, positive aggregate PnL, and
more profitable windows than losing windows. This is a separate anti-overfitting gate from
the segment-stratified holdout validation.

The final result includes:

- `seed`
- `bestTrain`
- `validation`
- `stressValidation`
- `walkForwardValidation`
- `acceptanceGates`
- `acceptanceBlockers`
- `acceptanceRequirements`
- `accepted`
- dataset counts for train and validation slices
- paper-signal summary gates; a strategy with enough settled negative paper signals cannot be accepted

Use `acceptanceBlockers` as the machine-readable handoff for the next action. For example,
`execution_quality_below_partial_orderbook` means the strategy may be statistically
interesting but still cannot be treated as live-ready until more forward orderbook data is
collected. Validation or stress blockers mean the strategy family or GA search space needs
work before more data alone can justify trading.

## Risk Model

The default hard limits are:

```text
maxRiskPerTrade = currentEquity * 10%
maxDailyLoss = initialCapital * 20%
maxDrawdown = initialCapital * 25%
maxConsecutiveLosses = 6
maxOpenMarkets = 1
```

Optional Kelly sizing is fractional and clipped:

```text
effectiveRisk = min(hardRiskLimit, fractionalKellyRisk)
```

The backtester must never use Kelly to exceed desk-style hard limits.

## Segment Analysis

Every report includes `segmentBreakdown` where trades are grouped by:

- `weekday_beijing_day`
- `weekday_beijing_night`
- `weekend_beijing_day`
- `weekend_beijing_night`

This is required because Beijing daytime/nighttime and weekday/weekend liquidity can differ materially.

The genetic search can also restrict candidate entries to one Beijing segment through
`targetSegment`. This lets the optimizer test whether a parameter set only works in a
specific liquidity regime instead of averaging across weekday daytime, weekday nighttime,
weekend daytime, and weekend nighttime markets.

## Interpretation Rules

- `orderbook_snapshot` evidence is stronger than `clob_prices_history`.
- `clob_prices_history` is a proxy and must not be interpreted as guaranteed fillable book liquidity.
- Binance spot is an auxiliary feature only, not the Polymarket settlement source.
- A profitable backtest is a research candidate, not approval for live trading.

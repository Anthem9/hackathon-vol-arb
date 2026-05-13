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

Run live observation, which captures orderbook snapshots and persists paper signals after each iteration:

```bash
pnpm --filter @vol-arb/api btc5m:research observe-live --duration-seconds 3600 --interval-ms 1000 --progress-every 30
```

Check whether the dataset is dense enough for executable limit-order backtests:

```bash
pnpm --filter @vol-arb/api btc5m:research coverage --days 7
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
pnpm --filter @vol-arb/api btc5m:research genetic --days 7 --limit-markets 2016 --generations 6 --population 12 --validation-fraction 0.2857 --persist-best
```

## Resource Controls

Defaults are intentionally conservative:

- Collectors run in a single process.
- API calls are throttled by CLI options.
- Backtests read data in market batches.
- Genetic search defaults to 6 generations and 12 candidates.
- Search scoring penalizes drawdown and ignores tiny-sample candidates.

Increase limits only after the first reports are inspected.

## Strategy Model

The first implemented strategies are:

- `lottery_reprice`: looks for cheap UP/DOWN contracts and exits with limit sells when the market reprices.
- `probability_cone`: builds a baseline UP probability from auxiliary BTC open price,
  current price, remaining time, and rolling volatility, then compares that baseline
  against the UP/DOWN contract prices.

Both strategies support:

- dynamic position sizing from current equity,
- limit-only entry,
- limit-entry fill verification from subsequent market data within `entryMaxWaitSeconds`,
- optional recent same-outcome trade-volume filtering before entry,
- take-profit limit exit,
- stop-loss limit exit,
- time-based limit exit,
- optional hold-to-settlement fallback,
- decision delay,
- assumed spread for price-history proxy data.
- Beijing day/night and weekday/weekend segment reporting.
- trader-style risk stops before new entries.

## Genetic Algorithm

The genetic search reads the dataset once, then performs a time-ordered train/validation
split inside each Beijing segment. This keeps weekday daytime, weekday nighttime,
weekend daytime, and weekend nighttime markets represented in validation when enough
markets exist. With the default 7-day window, the validation fraction is `2/7`.

The genetic search mutates these parameters:

- `entryMaxPrice`
- `takeProfitMultiple`
- `stopLossFraction`
- `maxHoldSeconds`
- `minSecondsRemaining`
- `maxSecondsRemaining`
- `probabilityEdge`
- `assumedSpread`
- `decisionDelaySeconds`
- `entryMaxWaitSeconds`
- `kellyFraction`
- `coneVolatilityMultiplier`
- `minRecentTradeVolume`
- `tradeVolumeLookbackSeconds`
- `useKellySizing`
- `targetSegment`: `all`, `weekday_beijing_day`, `weekday_beijing_night`,
  `weekend_beijing_day`, or `weekend_beijing_night`

Fitness is:

```text
totalPnl - maxDrawdown * 0.35 + winRate * 2
```

Candidates with fewer than 8 train trades are heavily penalized, and validation acceptance
requires at least 8 validation trades, positive PnL, and acceptable drawdown.

The final result includes:

- `bestTrain`
- `validation`
- `accepted`
- dataset counts for train and validation slices
- paper-signal summary gates; a strategy with enough settled negative paper signals cannot be accepted

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

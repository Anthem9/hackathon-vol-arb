import {
  collectAuxiliaryBtcOneMinute,
  collectBtc5mPriceHistory,
  collectBtc5mTrades,
  collectCurrentOrderbookSnapshots,
  collectRecentBtc5mMarkets,
  discoverBtc5mDataSources,
  runBtc5mBacktest,
  runBtc5mGeneticSearch,
} from "./btc5m-research-service";
import { closeDatabase } from "../db/postgres";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]) {
  const [command = "help", ...rest] = argv;
  const args: Args = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return { command, args };
}

function numberArg(args: Args, key: string, fallback: number) {
  const value = args[key];
  if (typeof value !== "string") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolArg(args: Args, key: string) {
  return args[key] === true || args[key] === "true";
}

function usage() {
  return `Usage:
  pnpm --filter @vol-arb/api btc5m:research probe
  pnpm --filter @vol-arb/api btc5m:research collect-markets --days 7 --limit 2016
  pnpm --filter @vol-arb/api btc5m:research collect-price-history --days 7 --limit-markets 2016
  pnpm --filter @vol-arb/api btc5m:research collect-trades --days 7 --limit-markets 2016 --pages-per-token 2
  pnpm --filter @vol-arb/api btc5m:research collect-btc-price --days 7
  pnpm --filter @vol-arb/api btc5m:research snapshot-orderbook
  pnpm --filter @vol-arb/api btc5m:research backtest --days 7 --limit-markets 2016 --persist
  pnpm --filter @vol-arb/api btc5m:research genetic --days 7 --generations 6 --population 12 --persist-best

All simulated orders are limit orders. The default initial capital is 100 USDC and max risk per trade is 10% of current equity.`;
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(usage());
    return;
  }
  if (command === "probe") {
    console.log(JSON.stringify(await discoverBtc5mDataSources(), null, 2));
    return;
  }
  if (command === "collect-markets") {
    console.log(
      JSON.stringify(
        await collectRecentBtc5mMarkets({
          days: numberArg(args, "days", 7),
          limit: numberArg(args, "limit", 2016),
          throttleMs: numberArg(args, "throttle-ms", 100),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "collect-price-history") {
    console.log(
      JSON.stringify(
        await collectBtc5mPriceHistory({
          days: numberArg(args, "days", 7),
          limitMarkets: numberArg(args, "limit-markets", 2016),
          throttleMs: numberArg(args, "throttle-ms", 100),
          fidelitySeconds: numberArg(args, "fidelity-seconds", 60),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "collect-trades") {
    console.log(
      JSON.stringify(
        await collectBtc5mTrades({
          days: numberArg(args, "days", 7),
          limitMarkets: numberArg(args, "limit-markets", 2016),
          throttleMs: numberArg(args, "throttle-ms", 100),
          pagesPerToken: numberArg(args, "pages-per-token", 2),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "collect-btc-price") {
    console.log(JSON.stringify(await collectAuxiliaryBtcOneMinute({ days: numberArg(args, "days", 7), throttleMs: numberArg(args, "throttle-ms", 200) }), null, 2));
    return;
  }
  if (command === "snapshot-orderbook") {
    console.log(JSON.stringify(await collectCurrentOrderbookSnapshots(), null, 2));
    return;
  }
  if (command === "backtest") {
    console.log(
      JSON.stringify(
        await runBtc5mBacktest({
          days: numberArg(args, "days", 7),
          limitMarkets: numberArg(args, "limit-markets", 2016),
          persist: boolArg(args, "persist"),
        }),
        null,
        2,
      ),
    );
    return;
  }
  if (command === "genetic") {
    console.log(
      JSON.stringify(
        await runBtc5mGeneticSearch({
          days: numberArg(args, "days", 7),
          limitMarkets: numberArg(args, "limit-markets", 2016),
          generations: numberArg(args, "generations", 6),
          population: numberArg(args, "population", 12),
          persistBest: boolArg(args, "persist-best"),
        }),
        null,
        2,
      ),
    );
    return;
  }
  throw new Error(`Unknown command: ${command}\n${usage()}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });

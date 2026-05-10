import { getDeepBookPositionState, getDeepBookStatus } from "./deepbook-transaction-service";

type MonitorOptions = {
  owner?: string;
  managerId?: string;
  intervalMs: number;
  watch: boolean;
};

function parseArgs(argv: string[]): MonitorOptions {
  const options: MonitorOptions = {
    intervalMs: 10_000,
    watch: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--owner") {
      options.owner = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--manager" || arg === "--manager-id") {
      options.managerId = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--watch") {
      options.watch = true;
      continue;
    }
    if (arg === "--interval") {
      const seconds = Number(argv[index + 1]);
      if (!Number.isFinite(seconds) || seconds < 1) throw new Error("--interval must be at least 1 second");
      options.intervalMs = Math.trunc(seconds * 1000);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      throw new Error(
        "Usage: tsx src/services/deepbook-wallet-monitor-cli.ts --owner <sui-address> --manager <manager-id> [--watch] [--interval seconds]",
      );
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function summarizePositions(positions: Awaited<ReturnType<typeof getDeepBookPositionState>>["positions"]) {
  return positions.map((position) => ({
    digest: position.digest,
    lifecycle: position.lifecycle,
    oracleId: position.oracleId,
    expiry: position.expiry,
    strike: position.strike,
    direction: position.direction,
    quantity: position.quantity,
    redeemReady: position.redeemReady,
    blocker: position.redeemBlockedReason,
  }));
}

async function snapshot(options: MonitorOptions) {
  const [status, positionState] = await Promise.all([
    getDeepBookStatus(options.managerId, options.owner),
    getDeepBookPositionState(options.managerId, options.owner),
  ]);
  return {
    observedAt: new Date().toISOString(),
    owner: options.owner ?? status.walletBinding?.owner ?? status.managerSummary?.owner ?? null,
    managerId: positionState.managerId || status.configuredManagerId || status.walletBinding?.managerId || null,
    readiness: status.readiness,
    managerError: status.managerError,
    oracleCandidates: status.oracleCandidates.length,
    lifecycle: positionState.lifecycle,
    managerSummary: positionState.managerSummary
      ? {
          trading_balance: positionState.managerSummary.trading_balance,
          open_exposure: positionState.managerSummary.open_exposure,
          redeemable_value: positionState.managerSummary.redeemable_value,
          realized_pnl: positionState.managerSummary.realized_pnl,
          unrealized_pnl: positionState.managerSummary.unrealized_pnl,
          account_value: positionState.managerSummary.account_value,
          open_positions: positionState.managerSummary.open_positions,
          awaiting_settlement_positions: positionState.managerSummary.awaiting_settlement_positions,
        }
      : null,
    positions: summarizePositions(positionState.positions),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.owner || !options.managerId) {
    throw new Error("Both --owner and --manager are required for connected-wallet acceptance monitoring.");
  }

  do {
    console.log(JSON.stringify(await snapshot(options), null, 2));
    if (!options.watch) break;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  } while (true);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

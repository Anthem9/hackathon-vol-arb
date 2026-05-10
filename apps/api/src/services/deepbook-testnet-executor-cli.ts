import { parseExecutorCliArgs, runDeepBookTestnetAction } from "./deepbook-testnet-executor";

try {
  const result = await runDeepBookTestnetAction(parseExecutorCliArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

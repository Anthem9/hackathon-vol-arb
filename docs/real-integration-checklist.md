# Real Integration Checklist

This checklist is the handoff from the mock demo to the real-service integration stage. Do not commit private keys, mnemonics, API secrets, passphrases, keystores, or `.env`.

## Local Secrets

- Keep all generated private keys and provider tokens in local `.env`.
- Commit only `.env.example`, with variable names and safe public defaults.
- Never paste wallet private keys, mnemonics, CLOB API secrets, or Ankr tokens into issues, PRs, README files, screenshots, or demo recordings.

## Sui Testnet

- Network: Sui Testnet.
- Funding target: generated local `SUI_TESTNET_ADDRESS` in `.env`.
- Test funds needed: start with 10 test SUI for wallet flows, repeated object reads, deposits, and failed transaction retries.
- RPC strategy:
  - Prefer testnet gRPC for new Sui integration work where SDK support is ready.
  - Keep testnet HTTPS RPC configured as a fallback while the ecosystem migration continues.
- DeepBook Predict public testnet integration values are in `.env.example`:
  - Predict server URL
  - Predict package ID
  - Predict registry ID
  - Predict object ID
  - DUSDC quote asset type and currency ID
- Remaining discovery task: identify the BTC oracle or BTC market key from the Predict server oracle list.

## Polygon / Polymarket

- Network for local wallet testing: Polygon Amoy.
- Funding target: generated local `POLYGON_TEST_ADDRESS` in `.env`.
- Test funds needed: 1-2 Amoy POL is enough for wallet/RPC/signing tests; request more only if deploying or writing contracts.
- Faucet options:
  - Alchemy Polygon Amoy faucet
  - QuickNode Polygon faucet
  - GetBlock faucet
  - StakePool faucet
- Polymarket data:
  - Gamma API is public and does not require authentication for market discovery.
  - Data API is public and does not require authentication for public activity/positions style data.
  - CLOB read endpoints are public for orderbook, prices, spreads, and price history.
- Polymarket trading:
  - Authenticated CLOB endpoints require L2 API credentials.
  - L2 credentials are created or derived by signing with the wallet private key via the official CLOB SDK.
  - Builder API keys are separate credentials for builder/relayer attribution and are created in the Polymarket builder settings page.
- Production caveat: Polymarket trading is on Polygon mainnet. Treat Amoy as wallet/RPC/signing rehearsal, not a real Polymarket trading sandbox, unless Polymarket publishes a separate test trading environment.

## Price Sources

- Start with free public BTC spot feeds:
  - Binance public market data
  - Coinbase public exchange products
  - CoinGecko public simple price API
- Use at least two sources in Version 2 and mark the price feed stale if they diverge beyond a configured threshold.
- Keep paid API keys optional until rate limits block real testing.

## Version 2 Exit Criteria

- Mock mode still works.
- Real read-only mode can fetch:
  - Sui/DeepBook Predict status and oracle list.
  - DeepBook Predict BTC oracle or market state.
  - Polymarket BTC-related markets and CLOB prices.
  - BTC spot from at least two free sources.
- Hybrid mode can compare real surfaces with mock fallback when one source is stale.
- No real order submission is enabled until explicit kill-switch and dry-run controls are visible in the UI.

## Sources

- Sui DeepBook Predict docs: https://docs.sui.io/onchain-finance/deepbook-predict/
- Sui DeepBook Predict contract information: https://docs.sui.io/onchain-finance/deepbook-predict/contract-information
- DeepBook Predict announcement: https://blog.sui.io/introducing-deepbook-predict/
- Polymarket API reference: https://docs.polymarket.com/api-reference
- Polymarket authentication: https://docs.polymarket.com/api-reference/authentication
- Polymarket builder API keys: https://docs.polymarket.com/builders/api-keys
- Polygon Amoy faucet docs: https://docs.polygon.technology/tools/gas/matic-faucet
- Polygon Amoy RPC docs: https://docs.polygon.technology/pos/reference/rpc-endpoints

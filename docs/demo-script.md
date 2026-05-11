# Demo Script

This demo should present the project as a real operator terminal, not a fake hackathon-only execution path. DeepBook Predict execution is Sui Testnet-only until official mainnet support exists.

## Setup

- Start the production-like stack:

```bash
docker compose -f docker-compose.production-like.yml up -d --build api web
```

- Open `http://localhost:3001`.
- Keep Slush on Sui Testnet if showing wallet signing.
- Do not show `.env`, private keys, API secrets, RPC tokens, or Polymarket L2 credentials.

## Talk Track

1. Open the dashboard and frame the product:
   - "This is a volatility-arbitrage operator terminal for DeepBook Predict BTC markets."
   - "DeepBook Predict is currently testnet-only, so Sui Testnet is the real execution venue for this build."
   - "Polymarket is used for external market context and guarded account integration."

2. Show source health and BTC spot:
   - Point to BTC spot, SVI health, source status, and fallback state.
   - Explain that BTC price uses public sources plus an optional configured paid or higher-quota endpoint.
   - Show that stale or divergent data becomes an alert/risk input instead of silently driving execution.

3. Show surface comparison:
   - Compare DeepBook SVI with external bid, mid, and ask surfaces.
   - Explain that midpoint edge alone is not enough; spread, expiry mismatch, stale oracle data, and wallet dry-run gates matter.

4. Show opportunities:
   - Highlight `watch` and `reject` decisions.
   - Point to exact reject reasons.
   - State that server-side opportunities do not become executable until the connected wallet has passed a DeepBook Predict mint dry-run for that action.

5. Show DeepBook Testnet readiness:
   - Show active BTC OracleSVI candidates.
   - Explain that the executor tries active candidates until one passes protocol dry-run, avoiding false blocks from early candidates that are not mintable.

6. Show wallet flow:
   - Connect Slush on Sui Testnet.
   - Show owner-matched PredictManager discovery/binding.
   - Show wallet DUSDC, manager DUSDC, gas, open exposure, open positions, redeemable value, and next safe action.
   - For a live demo, use dry-run first. Only sign real Sui Testnet transactions if the operator intentionally wants to spend testnet funds.

7. Show transaction lifecycle:
   - Open Execution History.
   - Show persisted create-manager, deposit, mint, redeem, and withdraw records.
   - Show reconcile/backfill controls and explain that they do not sign transactions.

8. Show Polymarket account controls:
   - Open Polymarket Trading Readiness.
   - Show L2-authenticated collateral balance, allowance, positions, and open orders.
   - Preview an order to show notional, max loss, account funding preflight, and blockers.
   - Show that live order/cancel execution stays blocked unless live flags, explicit approval, Polygon mainnet, funding, allowance, notional cap, and exact confirmation text all pass.

9. Show operations:
   - Open Maintenance and show `NO SIGNING`.
   - Mention Postgres persistence, backup/restore, health checks, secret scan, and committed Playwright smoke.

10. Close:
   - "The project does not pretend testnet is mainnet. It completes the real DeepBook Predict testnet lifecycle, keeps future mainnet migration gated, and hardens the surrounding operator workflow for real use."

## Recording Checklist

- Browser URL is `localhost:3001`.
- Wallet network is Sui Testnet.
- No secret-bearing terminal or wallet export screen is visible.
- Show one successful dashboard refresh.
- Show one wallet dry-run or existing persisted transaction record.
- Show Polymarket order preview blocked by current risk/funding/live gates.
- Show Maintenance `NO SIGNING`.
- End with roadmap: DeepBook Predict mainnet migration is deferred until official support exists.

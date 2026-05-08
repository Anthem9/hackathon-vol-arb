# Security Notes

Keep all real credentials out of Git.

Never commit:

- Wallet private keys, mnemonics, passphrases, or keystores
- Exchange API keys or tokens
- `.env.local`
- `auth.json`
- Local databases containing credentials

Use `.env.example` for placeholders only.

## Version 2 Runtime

- Real service integration is read-only.
- Polymarket CLOB calls use public market data endpoints only.
- DeepBook Predict calls read public testnet objects only.
- Wallet private keys may exist in local `.env` for later signing tests, but Version 2 does not import or use them for order execution.
- Real order submission remains disabled by dry-run risk controls until a later explicit implementation stage.

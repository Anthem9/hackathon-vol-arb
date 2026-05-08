# Security Notes

Version 1 requires no secrets. Keep all real credentials out of Git.

Never commit:

- Wallet private keys, mnemonics, passphrases, or keystores
- Exchange API keys or tokens
- `.env.local`
- `auth.json`
- Local databases containing credentials

Use `.env.example` for placeholders only.

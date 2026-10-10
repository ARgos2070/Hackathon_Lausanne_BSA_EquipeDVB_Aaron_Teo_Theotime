# SQ Keys

Self-custody wallet prototype for the BSA x EPFL hackathon (Lausanne, 10 to 11 October 2026).
Student project presented to Swissquote, not affiliated with Swissquote. Testnet only (Base Sepolia), no real funds.

The full specification is in `CDC.md` (internal document, in French). Everything else in this repository is in English.

## Run locally

```bash
npm install
npm run dev
```

## Environment variables (names only)

Set these in `.env.local` and in the Vercel project. Never commit their values.

| Name | Where it is used |
|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | Browser and server |
| `NEXT_PUBLIC_RPC_URL` | Browser and server (public Base Sepolia RPC) |
| `CANDIDE_BUNDLER_URL` | Server only |
| `CANDIDE_PAYMASTER_URL` | Server only |
| `CANDIDE_SPONSORSHIP_POLICY_ID` | Server only |
| `SUPABASE_URL` | Server only |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only |

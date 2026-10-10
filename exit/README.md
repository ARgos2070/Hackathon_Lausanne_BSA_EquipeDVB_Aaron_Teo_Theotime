# exit/: recover an SQ Keys account without Swissquote

A standalone Node + TypeScript script showing that an SQ Keys client gets their funds back **even if every Swissquote service disappears**: domain, servers, passkeys bound to the SQ Keys domain, bundler and paymaster.

It uses only:

- a **public Base Sepolia RPC** (`https://sepolia.base.org` by default);
- contracts that are **already deployed and public**: Safe v1.4.1 and the Candide Social Recovery Module;
- the client's **12-word recovery phrase** and **k = 2 guardians of type "Ethereum address"**.

No Swissquote service, no passkey, no Candide bundler or paymaster. The new owner pays its own gas in ETH. Libraries: [viem](https://viem.sh) and [abstractionkit](https://docs.candide.dev) only; no home-made cryptography.

## What it proves

| Step | Contract call | Who |
|---|---|---|
| 1. Generate a new owner address | none | the client |
| 2. Phrase + 2 guardians approve the request off-chain | EIP-712 signatures (`getRecoveryRequestEip712Data`) | phrase holder, guardians |
| 3. Submit the approvals and start the delay | `multiConfirmRecovery(..., execute = true)` | the new owner (normal transaction) |
| 4. Wait for the delay, then finalize | `finalizeRecovery` | anyone (here: the new owner) |
| 5. Move the USDC out | Safe `execTransaction` → `USDC.transfer` | the new owner (normal transaction, no bundler) |

During the delay, the real client can still cancel with their phone key (`cancelRecovery`). This is the protection against guardians colluding or a stolen phrase, and the script does not use it.

## Real and simulated

| Real (Base Sepolia testnet) | Simulated or simplified for the demo |
|---|---|
| Safe v1.4.1, Candide Social Recovery Module, USDC (Circle) | The initial owner is an **EOA standing in for the phone passkey** (see below) |
| EIP-712 approvals, `multiConfirmRecovery`, delay, `finalizeRecovery`, USDC transfer | Guardians are **test keys** stored in `exit/.env` instead of separate people's wallets |
| BIP-39 recovery phrase (viem) | The recovery delay is **3 minutes** (Candide test module) instead of **3 days** |

**Initial owner.** In the SQ Keys app the Safe's owner is a passkey. Here the demo Safe's initial owner is an EOA standing in for that passkey and treated as "lost": the script never uses it after setup. The recovery module does not care about the owner type. It replaces the owners through the Safe's own owner management, whatever they are (EOA, passkey signer contract). So the exit path is identical for a passkey-owned SQ Keys account. Direct `execTransaction` also works on a Safe that has the ERC-4337 module enabled.

**Delay.** The module used here, `0x949d01d424bE050D09C16025dd007CB59b3A8c66`, has a **3-minute delay and is for testing only**. Production uses Candide's **3-day** version (`0x38275826E1933303E508433dD5f289315Da2541c`), giving the real client 3 days to cancel. The exit steps are the same.

## Network and contracts

| | Address |
|---|---|
| Network | Base Sepolia, chain id 84532 |
| Candide Social Recovery Module (3-minute delay, testing only) | `0x949d01d424bE050D09C16025dd007CB59b3A8c66` ([Candide deployments](https://docs.candide.dev/wallet/technical-reference/deployments)) |
| Safe L2 singleton v1.4.1 | `0x29fcB43b46531BcA003ddC8FCB67FFE91900C762` |
| Safe proxy factory v1.4.1 | `0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67` |
| Safe compatibility fallback handler v1.4.1 | `0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99` |
| USDC (Circle) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

Demo account policy (same rules as the app): guardians = {phrase, G1, G2, G3}, k = 2, on-chain threshold k + 1 = **3 of 4**. The "phrase lost" path (G1 + G2 + G3) also exists.

## Prerequisites

- Node.js 20 or later (tested with Node 24) and npm.
- A little **Base Sepolia ETH**, about 0.001 ETH for setup and 0.0005 ETH for recover. Faucets:
  - https://portal.cdp.coinbase.com/products/faucet (Coinbase Developer Platform)
  - https://www.alchemy.com/faucets/base-sepolia
  - https://faucet.quicknode.com/base/sepolia
  - https://console.optimism.io/faucet (Superchain faucet)
- Some **Base Sepolia test USDC**: https://faucet.circle.com (select Base Sepolia).

## Reproduce it from scratch (about 10 minutes)

```bash
git clone <this repository>
cd <repository>/exit
npm install
```

**1. Setup (demo preparation, creates your own demo account)**

```bash
npm run setup
```

- It generates the demo secrets (initial owner key, 12-word phrase, 3 guardian keys) into `exit/.env`. They are never printed.
- It prints the public addresses and waits until you send Base Sepolia ETH to the **initial owner** address it shows.
- It deploys the Safe, enables the recovery module and registers the 4 guardians with threshold 3, printing a Basescan link for each transaction.
- At the end, send test USDC from faucet.circle.com to the **Safe address** it prints.

**2. Check**

```bash
npm run status            # or: npm run status -- 0xAnySafeAddress
```

Expected: owner = initial owner, module enabled, 4 guardians, threshold 3 of 4, no pending recovery, USDC balance > 0.

**3. Recover (the real exit path)**

```bash
npm run recover
```

- It generates the new owner, prints its address and waits until you send it Base Sepolia ETH (there is no paymaster).
- The phrase and guardians 1 and 2 sign off-chain. The new owner submits `multiConfirmRecovery`. The script counts down the 3 minutes, then finalizes.
- It checks that the new owner is now the only owner, then moves all the USDC out of the Safe (to `RECIPIENT_ADDRESS`, or to the new owner by default).

Both commands are resumable: if one stops (network error, Ctrl+C), run it again and it continues from the on-chain state.

**Plan B: on-chain approvals.** If off-chain signatures are rejected, `npm run recover -- --onchain` makes the phrase account and guardians 1 and 2 each send `confirmRecovery` from their own address. Each of them then needs a little Base Sepolia ETH, and the script asks for it. This path is implemented but was not needed in our run.

## Environment variables (`exit/.env`)

`exit/.env` is gitignored and written by the scripts; see `exit/.env.example`. Names only:

| Name | Written by | Content |
|---|---|---|
| `RPC_URL` | you (optional) | any Base Sepolia JSON-RPC URL |
| `LOST_OWNER_PRIVATE_KEY` | setup | initial owner, stands in for the phone passkey |
| `RECOVERY_PHRASE` | setup | 12-word BIP-39 phrase (address at `m/44'/60'/0'/0/0`) |
| `GUARDIAN_1_PRIVATE_KEY`, `GUARDIAN_2_PRIVATE_KEY`, `GUARDIAN_3_PRIVATE_KEY` | setup | address guardians (test keys) |
| `SAFE_SALT_NONCE`, `SAFE_ADDRESS` | setup | demo Safe deployment |
| `NEW_OWNER_PRIVATE_KEY` | recover | the new owner |
| `RECIPIENT_ADDRESS` | you (optional) | destination of the USDC |

Testnet only. Never reuse these keys or this phrase on a real network.

## Our run (10 October 2026)

Demo Safe [`0x33aa834F5d44BE23f6beB49F1d54711a30f45578`](https://sepolia.basescan.org/address/0x33aa834F5d44BE23f6beB49F1d54711a30f45578):

- Setup: [Safe deployment](https://sepolia.basescan.org/tx/0x34d432179be6ca370c7740cdff72863274a34745daa5e05cbe3c44f504e9be81), [enableModule](https://sepolia.basescan.org/tx/0x930fb8046cea9a43d6a36a84cf95c08627b13c12ad00632f97623281d8265dd7), guardians [phrase](https://sepolia.basescan.org/tx/0xf909bc1f939e3830cf8ae679f1322f1810f0aedb030c2b17cc7091524d2bcb67), [G1](https://sepolia.basescan.org/tx/0x773b5d5fb2baa72609197d3d76c78d3b2a16228934b3ceff27559aab05cfbe15), [G2](https://sepolia.basescan.org/tx/0xc2da910e4d504da66c8b20236836b18fa673ced166cbe4255613ff0983047b2e), [G3](https://sepolia.basescan.org/tx/0xfc3d06e12f9febbedc3c83ec30c1db3cf5fcd8a68cfec36e94c6e780f390b9eb)
- Recovery: [multiConfirmRecovery](https://sepolia.basescan.org/tx/0x2dd7bf31105482e808b6084a4f32327fe36839ad16626d4b246166a2c4689fee) (15:42), [finalizeRecovery](https://sepolia.basescan.org/tx/0x6357837423d26b14db9db166a6ff30d375a70f701a17566712cf8a2f479c525e) (15:45), [20 USDC moved out](https://sepolia.basescan.org/tx/0xd67597039623c69dc7f36b312d68a1f16c190ec20b4e87e4a45f5ba800c8c4d8)
- New owner: `0xB4ee3A632eC48390cc93EC561c77CCe1abef9009`, total gas paid by it: about 0.000003 ETH.

## Files

- `src/setup.ts`: demo preparation.
- `src/recover.ts`: the exit path.
- `src/status.ts`: read-only view of any Safe and its recovery setup.
- `src/safe.ts`: direct Safe calls (deployment, `execTransaction` by the owner).
- `src/config.ts`: network, addresses, logging and the local `.env` store.

## Notes

- The public RPC is load-balanced, so a read right after a transaction can hit a node that is one block behind. The scripts wait for the RPC to reach the receipt's block before reading.
- The phrase address uses the standard Ethereum derivation path `m/44'/60'/0'/0/0`, the default of viem's `mnemonicToAccount`, so any standard wallet can sign with the phrase too.
- Instead of this script, the client can use any tool that calls the same public contracts (for example a block explorer's "write contract" tab and a standard wallet).

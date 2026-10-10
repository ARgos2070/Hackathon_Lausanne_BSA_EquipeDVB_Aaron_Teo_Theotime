// Shared configuration for the exit/ scripts: network, contract addresses,
// clients, logging, and the local .env store for demo secrets.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { SocialRecoveryModuleGracePeriodSelector } from "abstractionkit";
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  formatUnits,
  http,
  parseAbi,
  type Account,
  type Address,
  type Hash,
} from "viem";
import { baseSepolia } from "viem/chains";

export const ENV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", ".env");
dotenv.config({ path: ENV_PATH, quiet: true });

export const CHAIN = baseSepolia; // chain id 84532
export const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
export const EXPLORER = "https://sepolia.basescan.org";

// Candide Social Recovery Module, 3-minute grace period (testing only).
// Production uses the 3-day version (SocialRecoveryModuleGracePeriodSelector.After3Days).
export const RECOVERY_MODULE = SocialRecoveryModuleGracePeriodSelector.After3Minutes as Address;

// Safe v1.4.1 canonical deployments.
export const SAFE_SINGLETON_L2: Address = "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762";
export const SAFE_PROXY_FACTORY: Address = "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67";
export const SAFE_FALLBACK_HANDLER: Address = "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99";

// Circle USDC on Base Sepolia (6 decimals).
export const USDC: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const USDC_DECIMALS = 6;

// Demo policy: phrase + 3 address guardians, k = 2, on-chain threshold k + 1 = 3 (3 of 4).
export const K = 2;
export const ONCHAIN_THRESHOLD = K + 1;

export const ETH_FAUCETS = [
  "https://portal.cdp.coinbase.com/products/faucet (Coinbase Developer Platform)",
  "https://www.alchemy.com/faucets/base-sepolia",
  "https://faucet.quicknode.com/base/sepolia",
  "https://console.optimism.io/faucet (Superchain faucet)",
  "or send from any wallet you already funded on Base Sepolia",
];
export const USDC_FAUCET = "https://faucet.circle.com (select Base Sepolia)";

export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

export function walletFor(account: Account) {
  return createWalletClient({ account, chain: CHAIN, transport: http(RPC_URL) });
}

export const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// ---------- logging ----------

export const txUrl = (hash: Hash) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (address: Address) => `${EXPLORER}/address/${address}`;

let stepNo = 0;
export function step(title: string) {
  stepNo += 1;
  console.log(`\n[${new Date().toLocaleTimeString("en-GB")}] STEP ${stepNo}: ${title}`);
}
export const info = (msg: string) => console.log(`    ${msg}`);
export const ok = (msg: string) => console.log(`    OK  ${msg}`);
export const todo = (msg: string) => console.log(`    >>> ACTION NEEDED: ${msg}`);

export const fmtEth = (wei: bigint) => `${formatEther(wei)} ETH`;
export const fmtUsdc = (units: bigint) => `${formatUnits(units, USDC_DECIMALS)} USDC`;

// Sends nothing itself: waits for a submitted transaction and prints its Basescan link.
export async function confirm(label: string, hash: Hash) {
  info(`${label}: sent, waiting for confirmation...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${label} reverted: ${txUrl(hash)}`);
  // The public RPC is load-balanced: wait until the node answering reads has this block too.
  while ((await publicClient.getBlockNumber({ cacheTime: 0 })) < receipt.blockNumber) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  ok(`${label} confirmed in block ${receipt.blockNumber}`);
  info(`Basescan: ${txUrl(hash)}`);
  return receipt;
}

export async function getEthBalance(address: Address) {
  return publicClient.getBalance({ address });
}

export async function getUsdcBalance(address: Address) {
  return publicClient.readContract({ address: USDC, abi: usdcAbi, functionName: "balanceOf", args: [address] });
}

// Polls until `address` holds at least `min` wei, printing the faucets once.
export async function waitForEth(address: Address, min: bigint, who: string) {
  let balance = await getEthBalance(address);
  if (balance >= min) return balance;
  todo(`send at least ${fmtEth(min)} (Base Sepolia) to the ${who}: ${address}`);
  info("Faucets:");
  for (const f of ETH_FAUCETS) info(`  - ${f}`);
  info("Waiting for the funds (checking every 5 s, Ctrl+C to stop)...");
  while (balance < min) {
    await new Promise((r) => setTimeout(r, 5000));
    balance = await getEthBalance(address);
  }
  ok(`${who} funded: ${fmtEth(balance)}`);
  return balance;
}

// ---------- local secret store (exit/.env, gitignored) ----------
// Values are written to disk only and never printed.

export function env(key: string): string | undefined {
  const value = process.env[key];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

export function requireEnv(key: string): string {
  const value = env(key);
  if (!value) throw new Error(`Missing ${key} in exit/.env. Run "npm run setup" first (see README).`);
  return value;
}

export function saveEnv(key: string, value: string) {
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8").split(/\r?\n/) : [];
  const line = `${key}=${value}`;
  const index = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (index >= 0) lines[index] = line;
  else {
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(line, "");
  }
  writeFileSync(ENV_PATH, lines.join("\n"), { mode: 0o600 });
  process.env[key] = value;
}

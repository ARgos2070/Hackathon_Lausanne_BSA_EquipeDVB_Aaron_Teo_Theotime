// Demo preparation: creates the dedicated exit/ demo account.
// - a Safe whose initial owner is an EOA standing in for the phone passkey (treated as "lost");
// - a 12-word BIP-39 recovery phrase and 3 "Ethereum address" guardians (test keys);
// - the Candide Social Recovery Module (3-minute delay) with guardians
//   {phrase address, G1, G2, G3} and threshold 3 (k = 2, 3 of 4).
// Secrets are written to exit/.env only and are never printed. Safe to re-run: it resumes.
import { SafeAccountV0_3_0 as SafeAccount, SocialRecoveryModule } from "abstractionkit";
import { english, generateMnemonic, generatePrivateKey, mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { getAddress, parseEther, type Address, type Hex } from "viem";
import {
  ONCHAIN_THRESHOLD,
  RECOVERY_MODULE,
  RPC_URL,
  USDC_FAUCET,
  addressUrl,
  env,
  fmtUsdc,
  getUsdcBalance,
  info,
  ok,
  requireEnv,
  saveEnv,
  step,
  todo,
  waitForEth,
} from "./config.js";
import { deploySafe, execFromOwner, readSafe } from "./safe.js";

const MIN_SETUP_ETH = parseEther("0.0005");

function ensureSecret(key: string, generate: () => string) {
  if (!env(key)) saveEnv(key, generate());
}

async function main() {
  console.log("SQ Keys exit/ demo setup (Base Sepolia, testnet only)");

  step("Demo secrets (stored in exit/.env, never printed)");
  ensureSecret("LOST_OWNER_PRIVATE_KEY", generatePrivateKey);
  ensureSecret("RECOVERY_PHRASE", () => generateMnemonic(english)); // 128 bits = 12 words
  ensureSecret("GUARDIAN_1_PRIVATE_KEY", generatePrivateKey);
  ensureSecret("GUARDIAN_2_PRIVATE_KEY", generatePrivateKey);
  ensureSecret("GUARDIAN_3_PRIVATE_KEY", generatePrivateKey);
  ensureSecret("SAFE_SALT_NONCE", () => String(Date.now()));

  const lostOwner = privateKeyToAccount(requireEnv("LOST_OWNER_PRIVATE_KEY") as Hex);
  const phrase = mnemonicToAccount(requireEnv("RECOVERY_PHRASE"));
  const guardianAddresses: Address[] = [
    phrase.address,
    privateKeyToAccount(requireEnv("GUARDIAN_1_PRIVATE_KEY") as Hex).address,
    privateKeyToAccount(requireEnv("GUARDIAN_2_PRIVATE_KEY") as Hex).address,
    privateKeyToAccount(requireEnv("GUARDIAN_3_PRIVATE_KEY") as Hex).address,
  ];
  info(`Initial owner (stands in for the phone passkey, "lost"): ${lostOwner.address}`);
  info(`Recovery phrase address (m/44'/60'/0'/0/0):               ${guardianAddresses[0]}`);
  guardianAddresses.slice(1).forEach((g, i) => info(`Guardian ${i + 1} (Ethereum address):                           ${g}`));

  step("Fund the initial owner (it pays the setup gas)");
  await waitForEth(lostOwner.address, MIN_SETUP_ETH, "initial owner");

  step("Deploy the demo Safe (v1.4.1, owner = initial owner, threshold 1)");
  let safe = env("SAFE_ADDRESS") as Address | undefined;
  let state = safe ? await readSafe(safe, RECOVERY_MODULE) : undefined;
  if (safe && state?.deployed) {
    ok(`already deployed: ${safe}`);
  } else {
    safe = await deploySafe(lostOwner, BigInt(requireEnv("SAFE_SALT_NONCE")), (predicted) =>
      saveEnv("SAFE_ADDRESS", predicted),
    );
    ok(`Safe deployed: ${safe}`);
    for (let i = 0; i < 10 && !state?.deployed; i++) {
      if (i) await new Promise((r) => setTimeout(r, 2000));
      state = await readSafe(safe, RECOVERY_MODULE);
    }
  }
  info(`Basescan: ${addressUrl(safe)}`);
  if (!state?.deployed) throw new Error("Safe not readable after deployment");
  if (state.owners.length !== 1 || getAddress(state.owners[0]) !== lostOwner.address) {
    throw new Error(`Safe owners are ${state.owners.join(", ")}: recovery already happened? Use a fresh setup.`);
  }

  const srm = new SocialRecoveryModule(RECOVERY_MODULE);

  step(`Enable the Candide Social Recovery Module (${RECOVERY_MODULE}, 3-minute delay)`);
  if (state.moduleEnabled) {
    ok("already enabled");
  } else {
    await execFromOwner(safe, lostOwner, SafeAccount.createEnableModuleMetaTransaction(RECOVERY_MODULE, safe), "enableModule");
  }

  step(`Register 4 guardians with threshold ${ONCHAIN_THRESHOLD} (phrase + 3 addresses, k = 2)`);
  let count = Number(await srm.guardiansCount(RPC_URL, safe));
  for (const [i, guardian] of guardianAddresses.entries()) {
    const label = i === 0 ? "recovery phrase" : `guardian ${i}`;
    if (await srm.isGuardian(RPC_URL, safe, guardian)) {
      ok(`${label} already registered`);
      continue;
    }
    // The threshold may never exceed the number of guardians, so it grows 1, 2, 3, 3.
    const threshold = BigInt(Math.min(count + 1, ONCHAIN_THRESHOLD));
    await execFromOwner(
      safe,
      lostOwner,
      srm.createAddGuardianWithThresholdMetaTransaction(guardian, threshold),
      `addGuardianWithThreshold(${label}, ${threshold})`,
    );
    count += 1;
  }
  const threshold = await srm.threshold(RPC_URL, safe);
  if (threshold !== BigInt(ONCHAIN_THRESHOLD)) {
    await execFromOwner(safe, lostOwner, srm.createChangeThresholdMetaTransaction(BigInt(ONCHAIN_THRESHOLD)), "changeThreshold");
  }
  ok(`guardians: ${count}, threshold: ${ONCHAIN_THRESHOLD}`);

  step("Fund the Safe with test USDC");
  const usdc = await getUsdcBalance(safe);
  if (usdc > 0n) ok(`Safe holds ${fmtUsdc(usdc)}`);
  else todo(`get test USDC from ${USDC_FAUCET} and send it to the Safe: ${safe}`);

  console.log('\nSetup complete. Check it with "npm run status", then run "npm run recover".');
}

main().catch((err) => {
  console.error(`\nSetup failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});

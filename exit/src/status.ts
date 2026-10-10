// Read-only view of a Safe and its recovery setup. Uses public on-chain data only.
// Usage: npm run status [-- <safeAddress>]   (defaults to SAFE_ADDRESS from exit/.env)
import { SocialRecoveryModule } from "abstractionkit";
import { getAddress, isAddress, type Address } from "viem";
import {
  RECOVERY_MODULE,
  RPC_URL,
  addressUrl,
  env,
  fmtEth,
  fmtUsdc,
  getEthBalance,
  getUsdcBalance,
  publicClient,
} from "./config.js";
import { readSafe } from "./safe.js";

async function main() {
  const arg = process.argv[2] ?? env("SAFE_ADDRESS");
  if (!arg || !isAddress(arg)) {
    console.log('No Safe address. Pass one ("npm run status -- 0x...") or run "npm run setup" first.');
    process.exit(1);
  }
  const safe = getAddress(arg);
  const srm = new SocialRecoveryModule(RECOVERY_MODULE);

  console.log(`Safe ${safe}`);
  console.log(`  ${addressUrl(safe)}`);
  const state = await readSafe(safe, RECOVERY_MODULE);
  if (!state.deployed) {
    console.log("  Not deployed yet.");
    return;
  }
  console.log(`  Owners:            ${state.owners.join(", ")} (threshold ${state.threshold})`);
  console.log(`  ETH balance:       ${fmtEth(await getEthBalance(safe))}`);
  console.log(`  USDC balance:      ${fmtUsdc(await getUsdcBalance(safe))}`);
  console.log(`  Recovery module:   ${RECOVERY_MODULE} (3-minute delay, testing only)`);
  console.log(`  Module enabled:    ${state.moduleEnabled}`);
  if (!state.moduleEnabled) return;

  const [guardians, threshold, request, nonce, block] = await Promise.all([
    srm.getGuardians(RPC_URL, safe),
    srm.threshold(RPC_URL, safe),
    srm.getRecoveryRequest(RPC_URL, safe),
    srm.nonce(RPC_URL, safe),
    publicClient.getBlock(),
  ]);
  console.log(`  Guardians (${guardians.length}):     ${guardians.join(", ")}`);
  console.log(`  Recovery threshold: ${threshold} of ${guardians.length}`);
  console.log(`  Recovery nonce:    ${nonce}`);
  if (request.executeAfter === 0n) {
    console.log("  Pending recovery:  none");
  } else {
    const left = Number(request.executeAfter - block.timestamp);
    console.log(`  Pending recovery:  new owners ${request.newOwners.join(", ")} (threshold ${request.newThreshold})`);
    console.log(`                     ${request.guardiansApprovalCount} approvals; ` +
      (left > 0 ? `can be finalized in ${left} s` : "delay elapsed, can be finalized now"));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

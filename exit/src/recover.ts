// Exit without Swissquote: recover the Safe with the recovery phrase and 2 address guardians,
// then move the USDC out. Only a public Base Sepolia RPC and the deployed Safe and Candide
// Social Recovery Module contracts are used: no Swissquote service, no passkey,
// no bundler, no paymaster. The new owner pays its own gas.
//
// Usage: npm run recover              (off-chain EIP-712 approvals, one multiConfirmRecovery)
//        npm run recover -- --onchain (plan B: each guardian sends confirmRecovery itself)
// Safe to re-run: it reads the on-chain state and resumes where it stopped.
import { SocialRecoveryModule } from "abstractionkit";
import { generatePrivateKey, mnemonicToAccount, privateKeyToAccount, type LocalAccount } from "viem/accounts";
import {
  encodeFunctionData,
  getAddress,
  isAddress,
  isAddressEqual,
  parseEther,
  verifyTypedData,
  type Address,
  type Hash,
  type Hex,
  type TypedData,
} from "viem";
import {
  CHAIN,
  RECOVERY_MODULE,
  RPC_URL,
  USDC,
  addressUrl,
  confirm,
  env,
  fmtEth,
  fmtUsdc,
  getUsdcBalance,
  info,
  ok,
  publicClient,
  requireEnv,
  saveEnv,
  step,
  usdcAbi,
  waitForEth,
  walletFor,
} from "./config.js";
import { execFromOwner, readSafe } from "./safe.js";

const ONCHAIN = process.argv.includes("--onchain");
const MIN_GAS_ETH = parseEther("0.0002");
const NEW_THRESHOLD = 1;

const srm = new SocialRecoveryModule(RECOVERY_MODULE);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The approving guardians: the recovery phrase and guardians 1 and 2 (guardian 3 is not needed).
function approvers(): { label: string; account: LocalAccount }[] {
  return [
    { label: "recovery phrase", account: mnemonicToAccount(requireEnv("RECOVERY_PHRASE")) },
    { label: "guardian 1", account: privateKeyToAccount(requireEnv("GUARDIAN_1_PRIVATE_KEY") as Hex) },
    { label: "guardian 2", account: privateKeyToAccount(requireEnv("GUARDIAN_2_PRIVATE_KEY") as Hex) },
  ];
}

async function send(from: LocalAccount, call: { to: string; data: string }, label: string) {
  const hash: Hash = await walletFor(from).sendTransaction({ to: call.to as Address, data: call.data as Hex });
  return confirm(label, hash);
}

// Off-chain path: each approver signs the EIP-712 recovery request, the new owner submits them all.
async function approveOffchain(safe: Address, newOwner: LocalAccount) {
  step("Phrase and 2 guardians sign the recovery request off-chain (EIP-712, no gas)");
  const { domain, types, messageValue } = await srm.getRecoveryRequestEip712Data(
    RPC_URL,
    BigInt(CHAIN.id),
    safe,
    [newOwner.address],
    BigInt(NEW_THRESHOLD),
  );
  const typedData = {
    domain: { ...domain, verifyingContract: domain.verifyingContract as Address },
    types: types as unknown as TypedData,
    primaryType: "ExecuteRecovery",
    message: messageValue,
  } as const;
  info(`Request: wallet ${messageValue.wallet}, new owner ${newOwner.address}, nonce ${messageValue.nonce}`);

  const pairs = [];
  for (const { label, account } of approvers()) {
    const signature = await account.signTypedData(typedData);
    // Local sanity check with viem before spending gas.
    if (!(await verifyTypedData({ ...typedData, address: account.address, signature }))) {
      throw new Error(`Invalid signature from ${label}`);
    }
    ok(`${label} signed (${account.address})`);
    pairs.push({ signer: account.address, signature });
  }

  step("New owner submits the 3 approvals: multiConfirmRecovery (execute = true)");
  await send(
    newOwner,
    srm.createMultiConfirmRecoveryMetaTransaction(safe, [newOwner.address], NEW_THRESHOLD, pairs, true),
    "multiConfirmRecovery",
  );
}

// Plan B: each approver confirms on-chain from its own address (each needs a little ETH).
async function approveOnchain(safe: Address, newOwner: LocalAccount) {
  step("Plan B: phrase and 2 guardians confirm on-chain, each from its own address");
  const list = approvers();
  for (const [i, { label, account }] of list.entries()) {
    if (await srm.hasGuardianApproved(RPC_URL, safe, account.address, [newOwner.address], NEW_THRESHOLD)) {
      ok(`${label} already approved`);
      continue;
    }
    await waitForEth(account.address, MIN_GAS_ETH, label);
    const last = i === list.length - 1;
    await send(
      account,
      srm.createConfirmRecoveryMetaTransaction(safe, [newOwner.address], NEW_THRESHOLD, last),
      `confirmRecovery by ${label}${last ? " (execute = true)" : ""}`,
    );
  }
}

async function main() {
  console.log("SQ Keys exit: recover a Safe without Swissquote (Base Sepolia, public RPC only)");
  console.log(`RPC: ${RPC_URL}`);

  const safe = getAddress(requireEnv("SAFE_ADDRESS"));
  step("Read the account on-chain");
  const state = await readSafe(safe, RECOVERY_MODULE);
  if (!state.deployed || !state.moduleEnabled) throw new Error("Safe not deployed or recovery module not enabled");
  info(`Safe ${safe}`);
  info(`Current owner: ${state.owners.join(", ")} (lost)`);
  info(`Guardians: ${(await srm.guardiansCount(RPC_URL, safe))}, threshold ${await srm.threshold(RPC_URL, safe)}`);
  info(`Basescan: ${addressUrl(safe)}`);

  step("Generate the new owner (a fresh key, stored in exit/.env)");
  if (!env("NEW_OWNER_PRIVATE_KEY")) saveEnv("NEW_OWNER_PRIVATE_KEY", generatePrivateKey());
  const newOwner = privateKeyToAccount(requireEnv("NEW_OWNER_PRIVATE_KEY") as Hex);
  info(`New owner: ${newOwner.address}`);

  const recovered = state.owners.length === 1 && isAddressEqual(state.owners[0], newOwner.address);
  if (recovered) {
    ok("the new owner already controls the Safe, skipping to the transfer");
  } else {
    step("Fund the new owner (no paymaster: it pays its own gas)");
    await waitForEth(newOwner.address, MIN_GAS_ETH, "new owner");

    let request = await srm.getRecoveryRequest(RPC_URL, safe);
    const ours =
      request.executeAfter > 0n &&
      request.newOwners.length === 1 &&
      isAddressEqual(request.newOwners[0] as Address, newOwner.address);
    if (request.executeAfter > 0n && !ours) {
      throw new Error(`Another recovery is pending (new owners ${request.newOwners.join(", ")}). It must be finalized or cancelled first.`);
    }
    if (ours) {
      ok("recovery already approved and executed, waiting for the delay");
    } else {
      if (ONCHAIN) await approveOnchain(safe, newOwner);
      else await approveOffchain(safe, newOwner);
      request = await srm.getRecoveryRequest(RPC_URL, safe);
      if (request.executeAfter === 0n) throw new Error("Recovery request not recorded on-chain");
      ok(`recovery executed with ${request.guardiansApprovalCount} approvals; delay started`);
    }

    step("Wait for the recovery delay (3 minutes on this test module, 3 days in production)");
    info(`Can be finalized after ${new Date(Number(request.executeAfter) * 1000).toLocaleTimeString("en-GB")}`);
    for (;;) {
      const { timestamp } = await publicClient.getBlock();
      const left = Number(request.executeAfter - timestamp);
      if (left < 0) break;
      info(`${left + 1} s left...`);
      await sleep(Math.min(15, left + 2) * 1000);
    }
    ok("delay elapsed");

    step("Finalize the recovery (anyone can call it; the new owner pays)");
    await send(newOwner, srm.createFinalizeRecoveryMetaTransaction(safe), "finalizeRecovery");
  }

  const after = await readSafe(safe, RECOVERY_MODULE);
  if (!after.deployed || after.owners.length !== 1 || !isAddressEqual(after.owners[0], newOwner.address)) {
    throw new Error(`Unexpected owners after recovery: ${after.deployed ? after.owners.join(", ") : "none"}`);
  }
  ok(`Safe owners are now [${newOwner.address}], threshold ${after.threshold}`);

  step("New owner moves the USDC out with a direct Safe transaction (no bundler)");
  const recipientEnv = env("RECIPIENT_ADDRESS");
  const recipient = recipientEnv && isAddress(recipientEnv) ? getAddress(recipientEnv) : newOwner.address;
  const balance = await getUsdcBalance(safe);
  if (balance === 0n) {
    info("The Safe holds no USDC: nothing to move.");
  } else {
    info(`Moving ${fmtUsdc(balance)} to ${recipient}`);
    await execFromOwner(
      safe,
      newOwner,
      { to: USDC, value: 0n, data: encodeFunctionData({ abi: usdcAbi, functionName: "transfer", args: [recipient, balance] }) },
      "USDC transfer",
    );
  }

  console.log("\nDone. Funds recovered without any Swissquote service.");
  console.log(`  Safe USDC:      ${fmtUsdc(await getUsdcBalance(safe))}`);
  console.log(`  Recipient USDC: ${fmtUsdc(await getUsdcBalance(recipient))}  (${addressUrl(recipient)})`);
  console.log(`  New owner gas left: ${fmtEth(await publicClient.getBalance({ address: newOwner.address }))}`);
}

main().catch((err) => {
  console.error(`\nRecovery failed: ${err instanceof Error ? err.message : err}`);
  if (!ONCHAIN) console.error('Plan B: "npm run recover -- --onchain" (each guardian confirms from its own address).');
  process.exit(1);
});

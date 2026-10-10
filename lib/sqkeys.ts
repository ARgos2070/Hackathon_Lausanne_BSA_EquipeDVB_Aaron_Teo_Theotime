// SQ Keys: contract between the UI and the wallet logic (CDC.md, section 7.7).
// Pages call only these functions.
//
// Real since milestone 1: createWallet, createRecoveryPhrase, confirmRecoveryPhrase,
// getBalance, sendUsdc, and the address and deployment state returned by getAccount.
// Every function marked MOCK still returns consistent fake data after 500 ms; mocks
// are replaced milestone by milestone without changing the signatures.
//
// Nothing secret is handled here: the passkey private key never leaves the phone, and
// the bundler and paymaster are reached through our own /api routes only.
//
// `k` is the number of guardians required in addition to the recovery phrase;
// the on-chain threshold is `k + 1`.

import { CandidePaymaster, SafeAccountV0_3_0 as SafeAccount } from "abstractionkit";
import type { MetaTransaction, WebauthnPublicKey } from "abstractionkit";
import { Bytes, Hex } from "ox";
import { createCredential, sign } from "ox/WebAuthnP256";
import { createPublicClient, encodeFunctionData, erc20Abi, formatUnits, http, isAddress, parseUnits } from "viem";
import { english, generateMnemonic } from "viem/accounts";
import { CHAIN_ID, RPC_URL, USDC_ADDRESS, USDC_DECIMALS } from "@/lib/chain";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GuardianType = "phrase" | "physical" | "device" | "person" | "address" | "swissquote";

export type Guardian = {
  address: string;
  label: string;
  type: GuardianType;
  addedAt: string;
};

export type Account = {
  address: string;
  deployed: boolean;
  owner: { type: "phone"; label: string; synced?: boolean };
  guardians: Guardian[];
  k: number;
  onchainThreshold: number;
  delaySeconds: number;
  recoveryInProgress: boolean;
};

export type CheckId = "simulation" | "sanctions" | "address" | "amount" | "application" | "unlimited";
export type CheckStatus = "ok" | "warning" | "blocked";
export type TransferCheck = { id: CheckId; status: CheckStatus; message: string };
export type TransferChecks = { checks: TransferCheck[]; highValue: boolean };

export type RecoveryStatus = "collecting" | "refused" | "pending" | "cancelled" | "finalized";

export type RecoveryRequest = {
  account: string;
  requesterDevice: string;
  knownDevice: boolean;
  createdAt: string;
  status: RecoveryStatus;
};

export type Recovery = {
  status: RecoveryStatus;
  approvals: number;
  onchainThreshold: number;
  endsAt?: string;
};

export type AlertType = "recovery_started" | "recovery_refused" | "recovery_cancelled" | "guardian_changed";
export type Alert = { id: string; type: AlertType; createdAt: string; message: string };

// ---------------------------------------------------------------------------
// MOCK data (fake addresses and hashes, no real key or phrase)
// ---------------------------------------------------------------------------

const MOCK_DELAY_MS = 500;

function mock<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_DELAY_MS));
}

const MOCK_ACCOUNT_ADDRESS = "0x5afe000000000000000000000000000000000001";
const MOCK_TX_HASH = "0x" + "ab".repeat(32);
const MOCK_SIGNATURE = "0x" + "cd".repeat(65);
const MOCK_HIGH_VALUE_USDC = 5;
const MOCK_SANCTIONED_ADDRESS = "0x000000000000000000000000000000000000dead";
const MOCK_KNOWN_RECIPIENT = "0x1111111111111111111111111111111111111111";
const MOCK_K = 2;
const MOCK_DELAY_SECONDS = 180;
const MOCK_REQUEST_ID = "req_mock_001";
const MOCK_CREATED_AT = "2026-10-10T12:30:00.000Z";

// Placeholder words, not a valid BIP-39 phrase.
const MOCK_NEW_WORDS = [
  "marble", "needle", "orange", "pencil", "quartz", "river",
  "silver", "tunnel", "umbrella", "violin", "window", "yellow",
];

const MOCK_GUARDIANS: Guardian[] = [
  { address: "0x9a00000000000000000000000000000000000001", label: "Recovery phrase", type: "phrase", addedAt: MOCK_CREATED_AT },
  { address: "0x9a00000000000000000000000000000000000002", label: "Téo", type: "person", addedAt: MOCK_CREATED_AT },
  { address: "0x9a00000000000000000000000000000000000003", label: "Physical key", type: "physical", addedAt: MOCK_CREATED_AT },
  { address: "0x9a00000000000000000000000000000000000004", label: "Hardware wallet", type: "address", addedAt: MOCK_CREATED_AT },
];

// ---------------------------------------------------------------------------
// Identity and account
// ---------------------------------------------------------------------------

// MOCK: will go through sq-mock.
export function loginSwissquote(clientId: string, password: string): Promise<{ clientId: string; name: string }> {
  void password;
  return mock({ clientId, name: "Léa" });
}

// What this device remembers about the account. Public data only: the passkey ID,
// its public key and the Safe address. The private key stays in the phone.
type StoredAccount = { credentialId: string; pubkeyX: string; pubkeyY: string; address: string };

const STORAGE_KEY = "sqkeys.account";

function readStoredAccount(): StoredAccount | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredAccount) : null;
  } catch {
    return null;
  }
}

function requireStoredAccount(): StoredAccount {
  const account = readStoredAccount();
  if (!account) throw new Error("No account on this device. Create your phone key first.");
  return account;
}

function publicKeyOf(account: StoredAccount): WebauthnPublicKey {
  return { x: BigInt(account.pubkeyX), y: BigInt(account.pubkeyY) };
}

function publicClient() {
  return createPublicClient({ transport: http(RPC_URL) });
}

async function isDeployed(address: string): Promise<boolean> {
  const code = await publicClient().getCode({ address: address as `0x${string}` });
  return code !== undefined && code !== "0x";
}

function readUsdcBalance(address: string): Promise<bigint> {
  return publicClient().readContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address as `0x${string}`],
  });
}

// At least 2 decimals, at most 6 ("25.00", "0.123456").
function formatUsdc(value: bigint): string {
  const [whole, fraction = ""] = formatUnits(value, USDC_DECIMALS).split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

// True when the user dismissed the passkey prompt (possibly wrapped by a library error).
function isPasskeyCancellation(err: unknown): boolean {
  for (let e = err as { name?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.name === "NotAllowedError" || e.name === "AbortError") return true;
  }
  return false;
}

// The most specific message of an error chain: our relay's refusals (unknown account,
// daily limit, contract not allowed) are the innermost cause of AbstractionKit errors.
function deepestMessage(err: unknown): string {
  let message = "Something went wrong. Try again.";
  for (let e = err as { message?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (typeof e.message === "string" && e.message) message = e.message;
  }
  return message;
}

// Builds one operation, has the paymaster sponsor it, signs it with the phone key and
// sends it, all through our own /api/bundler and /api/paymaster routes. The first
// operation of an account also deploys its Safe. Returns the transaction hash.
async function sendSponsoredOperation(account: StoredAccount, transactions: MetaTransaction[]): Promise<string> {
  const publicKey = publicKeyOf(account);
  const bundlerUrl = `${window.location.origin}/api/bundler`;
  const paymasterUrl = `${window.location.origin}/api/paymaster`;
  const safe = SafeAccount.initializeNewAccount([publicKey]);

  try {
    const unsigned = await safe.createUserOperation(transactions, RPC_URL, bundlerUrl, {
      expectedSigners: [publicKey],
      preVerificationGasPercentageMultiplier: 120,
      verificationGasLimitPercentageMultiplier: 120,
    });

    // The sponsorship policy is added by the server.
    const { userOperation } = await new CandidePaymaster(paymasterUrl).createSponsorPaymasterUserOperation(
      safe,
      unsigned,
      bundlerUrl,
    );

    // One passkey prompt: Face ID, fingerprint or device passcode.
    const { metadata, signature } = await sign({
      challenge: SafeAccount.getUserOperationEip712Hash(userOperation, CHAIN_ID) as Hex.Hex,
      credentialId: account.credentialId,
      rpId: window.location.hostname,
      userVerification: "required",
    });

    // The Safe verifier needs every clientDataJSON field except `type` and `challenge`.
    const { type: _type, challenge: _challenge, ...rest } = JSON.parse(metadata.clientDataJSON);
    void _type;
    void _challenge;
    const fields = Object.entries(rest)
      .map(([key, value]) => `"${key}":${JSON.stringify(value)}`)
      .join(",");

    const webauthnSignature = SafeAccount.createWebAuthnSignature({
      authenticatorData: Bytes.fromHex(metadata.authenticatorData).buffer as ArrayBuffer,
      clientDataFields: Hex.fromString(fields),
      rs: [BigInt(signature.r), BigInt(signature.s)],
    });
    userOperation.signature = SafeAccount.formatSignaturesToUseroperationSignature(
      [{ signer: publicKey, signature: webauthnSignature }],
      { isInit: userOperation.factory != null },
    );

    const response = await safe.sendUserOperation(userOperation, bundlerUrl);
    const receipt = await response.included();
    if (!receipt) throw new Error("The transaction was sent but not confirmed yet. Check again in a minute.");
    if (!receipt.success) throw new Error("The transaction was refused by the network. Nothing was sent.");
    return receipt.receipt.transactionHash;
  } catch (err) {
    if (isPasskeyCancellation(err)) throw new Error("Cancelled. Nothing was sent.");
    throw new Error(deepestMessage(err));
  }
}

// Creates the phone key (passkey A, the only owner of the Safe), computes the Safe
// address, registers it with our server and deploys the Safe with a first sponsored
// operation. Safe to call again: it resumes where a previous attempt stopped.
export async function createWallet(): Promise<{ address: string }> {
  let account = readStoredAccount();

  if (!account) {
    let credential;
    try {
      credential = await createCredential({
        name: "SQ Keys",
        rp: { id: window.location.hostname, name: "SQ Keys" },
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        attestation: "none",
        timeout: 60_000,
      });
    } catch (err) {
      if (isPasskeyCancellation(err)) throw new Error("Setup cancelled. Your key was not created.");
      throw new Error("Your phone key could not be created on this device.");
    }

    const publicKey = { x: BigInt(credential.publicKey.x), y: BigInt(credential.publicKey.y) };
    account = {
      credentialId: credential.id,
      pubkeyX: credential.publicKey.x,
      pubkeyY: credential.publicKey.y,
      address: SafeAccount.createAccountAddress([publicKey]),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
  }

  const response = await fetch("/api/accounts/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      address: account.address,
      credentialId: account.credentialId,
      pubkeyX: account.pubkeyX,
      pubkeyY: account.pubkeyY,
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "Your account could not be registered. Try again.");
  }

  if (!(await isDeployed(account.address))) {
    // An empty call from the Safe to itself: its only effect is to deploy the Safe.
    await sendSponsoredOperation(account, [{ to: account.address, value: 0n, data: "0x" }]);
  }
  return { address: account.address };
}

// The recovery phrase lives in this tab's memory only: never stored, never sent.
let recoveryWords: string[] | null = null;

// 12-word BIP-39 phrase generated in the browser (viem, English wordlist).
export async function createRecoveryPhrase(): Promise<{ words: string[] }> {
  recoveryWords = generateMnemonic(english).split(" ");
  return { words: [...recoveryWords] };
}

// Checks 3 words of the phrase. `index` is the 1-based word number shown to the user;
// the screen picks the 3 numbers at random.
export async function confirmRecoveryPhrase(answers: { index: number; word: string }[]): Promise<boolean> {
  const words = recoveryWords;
  if (!words) throw new Error("Your recovery phrase is no longer in memory. Create a new one.");
  const indexes = new Set(answers.map((a) => a.index));
  if (indexes.size < 3) return false;
  return answers.every(({ index, word }) => words[index - 1] === word.trim().toLowerCase());
}

// Real: address and deployment state. MOCK: owner label, guardians, k, delay and
// recovery state, until the recovery milestones.
export async function getAccount(): Promise<Account> {
  const { address } = requireStoredAccount();
  return {
    address,
    deployed: await isDeployed(address),
    owner: { type: "phone", label: "Phone key", synced: true },
    guardians: MOCK_GUARDIANS.map((g) => ({ ...g })),
    k: MOCK_K,
    onchainThreshold: MOCK_K + 1,
    delaySeconds: MOCK_DELAY_SECONDS,
    recoveryInProgress: false,
  };
}

// USDC balance of the Safe, read from Base Sepolia.
export async function getBalance(): Promise<{ usdc: string }> {
  const { address } = requireStoredAccount();
  return { usdc: formatUsdc(await readUsdcBalance(address)) };
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

// MOCK: demo rules only (one sanctioned address, one known recipient, 5 USDC limit).
export function checkTransfer(to: string, amount: string): Promise<TransferChecks> {
  const recipient = to.trim().toLowerCase();
  const sanctioned = recipient === MOCK_SANCTIONED_ADDRESS;
  const known = recipient === MOCK_KNOWN_RECIPIENT;
  const highValue = Number(amount) > MOCK_HIGH_VALUE_USDC;

  const checks: TransferCheck[] = [
    {
      id: "simulation",
      status: "ok",
      message: `You are sending ${amount} USDC. Nothing else leaves your account.`,
    },
    {
      id: "sanctions",
      status: sanctioned ? "blocked" : "ok",
      message: sanctioned ? "This address is on a sanctions list." : "Address not listed.",
    },
    {
      id: "address",
      status: known ? "ok" : "warning",
      message: known
        ? "Address already used."
        : "First time you send to this address. Check it character by character.",
    },
    {
      id: "amount",
      status: highValue ? "warning" : "ok",
      message: highValue
        ? "High amount: an extra confirmation will be required."
        : `Below your limit of ${MOCK_HIGH_VALUE_USDC} USDC.`,
    },
  ];
  return mock({ checks, highValue });
}

// Sends USDC from the Safe. Signed by the phone key, gas paid by the paymaster:
// the account never needs ETH.
export async function sendUsdc(to: string, amount: string): Promise<{ txHash: string }> {
  const account = requireStoredAccount();
  const recipient = to.trim();
  if (!isAddress(recipient)) throw new Error("This recipient address is not valid.");

  let value: bigint;
  try {
    value = parseUnits(amount.trim(), USDC_DECIMALS);
  } catch {
    throw new Error("This amount is not valid.");
  }
  if (value <= 0n) throw new Error("This amount is not valid.");

  const balance = await readUsdcBalance(account.address);
  if (value > balance) throw new Error(`Not enough USDC. Available: ${formatUsdc(balance)} USDC.`);

  const transfer: MetaTransaction = {
    to: USDC_ADDRESS,
    value: 0n,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, value] }),
  };
  return { txHash: await sendSponsoredOperation(account, [transfer]) };
}

// MOCK
export function approveApp(spender: string, amount: string | "unlimited"): Promise<{ txHash: string }> {
  void spender;
  void amount;
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK: will be verified by sq-mock.
export function signOwnershipProof(): Promise<{ message: string; signature: string; verified: boolean }> {
  return mock({
    message: `I confirm I own the wallet ${MOCK_ACCOUNT_ADDRESS}. Client SQ-000001. 2026-10-10.`,
    signature: MOCK_SIGNATURE,
    verified: true,
  });
}

// MOCK: will go through sq-mock.
export function transferFromSwissquote(amount: string): Promise<{ txHash: string }> {
  void amount;
  return mock({ txHash: MOCK_TX_HASH });
}

// ---------------------------------------------------------------------------
// Guardians (signed by the phone key, refused while a recovery is in progress)
// ---------------------------------------------------------------------------

// MOCK
export function createGuardianInvite(
  label: string,
  type: "physical" | "device" | "person",
): Promise<{ inviteId: string; inviteUrl: string }> {
  void label;
  void type;
  return mock({ inviteId: "inv_mock_001", inviteUrl: "/guardian/invite/inv_mock_001" });
}

// MOCK: runs on the guardian's device.
export function acceptGuardianInvite(inviteId: string): Promise<{ guardianAddress: string }> {
  void inviteId;
  return mock({ guardianAddress: MOCK_GUARDIANS[1].address });
}

// MOCK
export function addAddressGuardian(label: string, address: string, proofSignature: string): Promise<void> {
  void label;
  void address;
  void proofSignature;
  return mock(undefined);
}

// MOCK
export function setupRecovery(guardianAddresses: string[], k: number): Promise<{ txHash: string }> {
  void guardianAddresses;
  void k;
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK
export function removeGuardian(guardianAddress: string, newK: number): Promise<{ txHash: string }> {
  void guardianAddress;
  void newK;
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK
export function changeK(newK: number): Promise<{ txHash: string }> {
  void newK;
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK
export function replaceRecoveryPhrase(): Promise<{ words: string[]; txHash: string }> {
  return mock({ words: [...MOCK_NEW_WORDS], txHash: MOCK_TX_HASH });
}

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

// MOCK: will create the new device's passkey; a client ID will be resolved by the
// server through sq-mock /resolve-account, without storing it.
export function startRecovery(accountOrClientId: string): Promise<{ requestId: string; approveUrl: string }> {
  void accountOrClientId;
  return mock({ requestId: MOCK_REQUEST_ID, approveUrl: `/recovery/approve/${MOCK_REQUEST_ID}` });
}

// MOCK
export function approveRecoveryWithPhrase(
  requestId: string,
  words: string[],
): Promise<{ approvals: number; onchainThreshold: number }> {
  void requestId;
  void words;
  return mock({ approvals: 1, onchainThreshold: MOCK_K + 1 });
}

// MOCK: for the guardian's screen.
export function getRecoveryRequest(requestId: string): Promise<RecoveryRequest> {
  void requestId;
  return mock({
    account: MOCK_ACCOUNT_ADDRESS,
    requesterDevice: "iPhone, Safari",
    knownDevice: false,
    createdAt: MOCK_CREATED_AT,
    status: "collecting",
  });
}

// MOCK: runs on the guardian's device.
export function approveRecovery(requestId: string): Promise<{ approvals: number; onchainThreshold: number }> {
  void requestId;
  return mock({ approvals: 2, onchainThreshold: MOCK_K + 1 });
}

// MOCK: "Refuse and alert" is an app-level alert, never sent by email.
export function refuseRecovery(requestId: string, reason?: string): Promise<void> {
  void requestId;
  void reason;
  return mock(undefined);
}

// MOCK: no recovery in progress, consistent with getAccount().
export function getRecovery(account: string): Promise<null | Recovery> {
  void account;
  return mock(null);
}

// MOCK: will be signed by the phone key.
export function cancelRecovery(): Promise<{ txHash: string }> {
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK
export function finalizeRecovery(account: string): Promise<{ txHash: string }> {
  void account;
  return mock({ txHash: MOCK_TX_HASH });
}

// MOCK
export function getAlerts(): Promise<Alert[]> {
  return mock([
    {
      id: "alert_mock_001",
      type: "guardian_changed",
      createdAt: MOCK_CREATED_AT,
      message: "A guardian was added to your account.",
    },
  ]);
}

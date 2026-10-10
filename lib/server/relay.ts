// SERVER ONLY. JSON-RPC relay in front of the Candide bundler and paymaster
// (CDC.md, section 7.5). The Candide URLs and the sponsorship policy ID stay on the
// server: the browser only ever calls /api/bundler and /api/paymaster.

import { SafeAccountV0_3_0, SocialRecoveryModuleGracePeriodSelector } from "abstractionkit";
import { decodeFunctionData, getAddress, isAddress, isAddressEqual, parseAbi, size, slice, hexToBigInt, hexToNumber, type Hex } from "viem";
import { USDC_ADDRESS } from "@/lib/chain";
import {
  SPONSORED_OPS_PER_ACCOUNT_PER_DAY,
  countRecentSponsorships,
  isRegisteredAccount,
  logSponsorship,
  requireEnv,
} from "@/lib/server/supabase";

type Target = "bundler" | "paymaster";

// Only the methods AbstractionKit calls in our flows (create, sponsor, send, wait).
const ALLOWED_METHODS: Record<Target, readonly string[]> = {
  bundler: [
    "eth_chainId",
    "eth_supportedEntryPoints",
    "eth_estimateUserOperationGas",
    "eth_sendUserOperation",
    "eth_getUserOperationReceipt",
  ],
  paymaster: ["pm_chainId", "pm_supportedERC20Tokens", "pm_getPaymasterData"],
};

const UPSTREAM_ENV: Record<Target, string> = {
  bundler: "CANDIDE_BUNDLER_URL",
  paymaster: "CANDIDE_PAYMASTER_URL",
};

// JSON-RPC error codes of the relay (server-defined range).
const E_UNKNOWN_ACCOUNT = -32001;
const E_CAP_REACHED = -32002;
const E_CALL_NOT_ALLOWED = -32003;

class RelayError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function rpcError(id: unknown, code: number, message: string, status: number): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

// ---------------------------------------------------------------------------
// Call policy: what a sponsored operation is allowed to do
// ---------------------------------------------------------------------------

const safe4337ModuleAbi = parseAbi([
  "function executeUserOp(address to, uint256 value, bytes data, uint8 operation)",
  "function executeUserOpWithErrorString(address to, uint256 value, bytes data, uint8 operation)",
]);
const multiSendAbi = parseAbi(["function multiSend(bytes transactions)"]);

const OPERATION_CALL = 0;
const OPERATION_DELEGATECALL = 1;

// Contracts a sponsored operation may call, besides the Safe itself:
// USDC, the Candide recovery modules, and the passkey signer factory. AbstractionKit
// adds a call to that factory to the first operation of a passkey account (it deploys
// the passkey verifier and makes it the owner), so it has to be allowed.
const ALLOWED_TARGETS: readonly string[] = [
  USDC_ADDRESS,
  ...Object.values(SocialRecoveryModuleGracePeriodSelector),
  SafeAccountV0_3_0.DEFAULT_WEB_AUTHN_SIGNER_FACTORY,
];

function assertAllowedCall(sender: string, to: string, value: bigint, operation: number): void {
  if (operation !== OPERATION_CALL) {
    throw new RelayError(E_CALL_NOT_ALLOWED, "Sponsorship refused: delegate calls are not allowed.", 403);
  }
  if (value !== 0n) {
    throw new RelayError(E_CALL_NOT_ALLOWED, "Sponsorship refused: sending ETH is not allowed.", 403);
  }
  const allowed = isAddressEqual(to as Hex, sender as Hex) || ALLOWED_TARGETS.some((t) => isAddressEqual(to as Hex, t as Hex));
  if (!allowed) {
    throw new RelayError(E_CALL_NOT_ALLOWED, `Sponsorship refused: contract ${to} is not on the allowed list.`, 403);
  }
}

// MultiSend packs each call as: operation (1 byte), to (20), value (32), data length (32), data.
function assertAllowedBatch(sender: string, transactions: Hex): void {
  const total = size(transactions);
  let offset = 0;
  while (offset < total) {
    const operation = hexToNumber(slice(transactions, offset, offset + 1));
    const to = getAddress(slice(transactions, offset + 1, offset + 21));
    const value = hexToBigInt(slice(transactions, offset + 21, offset + 53));
    const dataLength = hexToNumber(slice(transactions, offset + 53, offset + 85));
    assertAllowedCall(sender, to, value, operation);
    offset += 85 + dataLength;
  }
  if (offset !== total) throw new Error("malformed multiSend payload");
}

function assertAllowedCallData(sender: string, callData: unknown): void {
  try {
    const { args } = decodeFunctionData({ abi: safe4337ModuleAbi, data: callData as Hex });
    const [to, value, data, operation] = args;
    const isBatch =
      operation === OPERATION_DELEGATECALL &&
      isAddressEqual(to, SafeAccountV0_3_0.DEFAULT_MULTISEND_CONTRACT_ADDRESS as Hex);
    if (isBatch) {
      if (value !== 0n) throw new RelayError(E_CALL_NOT_ALLOWED, "Sponsorship refused: sending ETH is not allowed.", 403);
      const { args: batch } = decodeFunctionData({ abi: multiSendAbi, data });
      assertAllowedBatch(sender, batch[0]);
    } else {
      assertAllowedCall(sender, to, value, operation);
    }
  } catch (err) {
    if (err instanceof RelayError) throw err;
    throw new RelayError(E_CALL_NOT_ALLOWED, "Sponsorship refused: the operation could not be decoded.", 403);
  }
}

// ---------------------------------------------------------------------------
// Per-method rules
// ---------------------------------------------------------------------------

function senderOf(params: unknown[]): string {
  const sender = (params[0] as { sender?: unknown } | undefined)?.sender;
  if (typeof sender !== "string" || !isAddress(sender)) {
    throw new RelayError(-32602, "Invalid params: the operation has no valid sender.", 400);
  }
  return sender;
}

async function assertRegistered(sender: string): Promise<void> {
  if (!(await isRegisteredAccount(sender))) {
    throw new RelayError(E_UNKNOWN_ACCOUNT, "Unknown account: this address is not a registered SQ Keys account.", 403);
  }
}

// Returns the params to forward upstream, and the sender to log once sponsored.
async function applyRules(target: Target, method: string, params: unknown[]): Promise<{ params: unknown[]; sponsoredSender?: string }> {
  if (target === "bundler" && method === "eth_sendUserOperation") {
    await assertRegistered(senderOf(params));
    return { params };
  }

  if (target === "paymaster" && method === "pm_getPaymasterData") {
    const sender = senderOf(params);
    const [userOperation, entryPoint, chainId] = params;
    if (typeof entryPoint !== "string" || !isAddress(entryPoint) || !isAddressEqual(entryPoint, SafeAccountV0_3_0.DEFAULT_ENTRYPOINT_ADDRESS)) {
      throw new RelayError(-32602, "Invalid params: unsupported EntryPoint.", 400);
    }
    await assertRegistered(sender);
    assertAllowedCallData(sender, (userOperation as { callData?: unknown }).callData);
    if ((await countRecentSponsorships(sender)) >= SPONSORED_OPS_PER_ACCOUNT_PER_DAY) {
      throw new RelayError(
        E_CAP_REACHED,
        `Daily limit reached: ${SPONSORED_OPS_PER_ACCOUNT_PER_DAY} sponsored operations per account per day.`,
        429,
      );
    }
    // The sponsorship policy is chosen by the server, whatever the browser sent.
    const context = { sponsorshipPolicyId: requireEnv("CANDIDE_SPONSORSHIP_POLICY_ID") };
    return { params: [userOperation, entryPoint, chainId, context], sponsoredSender: sender };
  }

  return { params };
}

// ---------------------------------------------------------------------------
// Relay
// ---------------------------------------------------------------------------

export async function relay(request: Request, target: Target): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(null, -32700, "Parse error: the request body is not JSON.", 400);
  }
  if (Array.isArray(body)) return rpcError(null, -32600, "Batch requests are not supported.", 400);

  const { id, method, params = [] } = (body ?? {}) as { id?: unknown; method?: unknown; params?: unknown };
  if (typeof method !== "string" || !Array.isArray(params)) {
    return rpcError(id, -32600, "Invalid JSON-RPC request.", 400);
  }
  if (!ALLOWED_METHODS[target].includes(method)) {
    return rpcError(id, -32601, `Method ${method} is not allowed on this relay.`, 403);
  }

  try {
    const rules = await applyRules(target, method, params);

    let upstream: Response;
    try {
      upstream = await fetch(requireEnv(UPSTREAM_ENV[target]), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: id ?? 1, method, params: rules.params }),
      });
    } catch {
      // Never forward the fetch error: it can contain the upstream URL and its key.
      return rpcError(id, -32603, `The ${target} service is unreachable. Try again.`, 502);
    }

    let result: { error?: unknown };
    try {
      result = await upstream.json();
    } catch {
      return rpcError(id, -32603, `The ${target} service returned an invalid response.`, 502);
    }

    if (rules.sponsoredSender && !result.error) await logSponsorship(rules.sponsoredSender);
    return Response.json(result);
  } catch (err) {
    if (err instanceof RelayError) return rpcError(id, err.code, err.message, err.status);
    console.error(`[relay:${target}]`, err instanceof Error ? err.message : "unknown error");
    return rpcError(id, -32603, "Server error. Try again.", 500);
  }
}

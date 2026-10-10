import { SafeAccountV0_3_0 } from "abstractionkit";
import { getAddress, isAddress } from "viem";
import {
  ACCOUNT_CREATIONS_PER_IP_PER_HOUR,
  clientIp,
  countRecentCreations,
  insertAccount,
  isRegisteredAccount,
} from "@/lib/server/supabase";

function fail(error: string, status: number) {
  return Response.json({ error }, { status });
}

function toCoordinate(value: unknown): bigint | null {
  if (typeof value !== "string" || !/^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/.test(value)) return null;
  return BigInt(value);
}

// Registers a new SQ Keys account: the Safe address and the passkey public key.
// Only public data is stored. Registered accounts are the ones the paymaster sponsors.
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return fail("Invalid request.", 400);
  }

  const { address, credentialId } = body;
  const x = toCoordinate(body.pubkeyX);
  const y = toCoordinate(body.pubkeyY);
  if (typeof address !== "string" || !isAddress(address) || x === null || y === null) {
    return fail("Invalid request.", 400);
  }
  if (typeof credentialId !== "string" || credentialId.length === 0 || credentialId.length > 1024) {
    return fail("Invalid request.", 400);
  }

  // The address must be the Safe computed from this passkey, nothing else.
  const expected = SafeAccountV0_3_0.createAccountAddress([{ x, y }]);
  if (getAddress(expected) !== getAddress(address)) {
    return fail("The address does not match this phone key.", 400);
  }

  try {
    if (await isRegisteredAccount(address)) return Response.json({ address: getAddress(address) });

    const ip = clientIp(request);
    if ((await countRecentCreations(ip)) >= ACCOUNT_CREATIONS_PER_IP_PER_HOUR) {
      return fail("Too many accounts created from this network. Try again in an hour.", 429);
    }

    await insertAccount({
      address: getAddress(address),
      credential_id: credentialId,
      pubkey_x: `0x${x.toString(16)}`,
      pubkey_y: `0x${y.toString(16)}`,
      created_ip: ip,
    });
    return Response.json({ address: getAddress(address) });
  } catch (err) {
    console.error("[accounts/register]", err instanceof Error ? err.message : "unknown error");
    return fail("Server error. Try again.", 500);
  }
}

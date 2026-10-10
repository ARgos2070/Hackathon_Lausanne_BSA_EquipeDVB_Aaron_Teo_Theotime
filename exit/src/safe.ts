// Direct Safe interactions over a plain JSON-RPC node: no bundler, no paymaster.
import {
  concat,
  encodeFunctionData,
  pad,
  parseAbi,
  parseEventLogs,
  zeroAddress,
  type Account,
  type Address,
  type Hex,
} from "viem";
import {
  SAFE_FALLBACK_HANDLER,
  SAFE_PROXY_FACTORY,
  SAFE_SINGLETON_L2,
  confirm,
  publicClient,
  walletFor,
} from "./config.js";

export const safeAbi = parseAbi([
  "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool success)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function isModuleEnabled(address module) view returns (bool)",
  "function nonce() view returns (uint256)",
]);

const factoryAbi = parseAbi([
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "event ProxyCreation(address indexed proxy, address singleton)",
]);

// Deploys a Safe v1.4.1 (L2) with a single owner and threshold 1. The owner pays the gas.
export async function deploySafe(owner: Account, saltNonce: bigint): Promise<Address> {
  const initializer = encodeFunctionData({
    abi: safeAbi,
    functionName: "setup",
    args: [[owner.address], 1n, zeroAddress, "0x", SAFE_FALLBACK_HANDLER, zeroAddress, 0n, zeroAddress],
  });
  const hash = await walletFor(owner).writeContract({
    address: SAFE_PROXY_FACTORY,
    abi: factoryAbi,
    functionName: "createProxyWithNonce",
    args: [SAFE_SINGLETON_L2, initializer, saltNonce],
  });
  const receipt = await confirm("Safe deployment", hash);
  const [event] = parseEventLogs({ abi: factoryAbi, eventName: "ProxyCreation", logs: receipt.logs });
  if (!event) throw new Error("ProxyCreation event not found");
  return event.args.proxy;
}

// Safe "pre-validated" signature: when msg.sender is an owner, the Safe accepts
// r = owner address, s = 0, v = 1 without any cryptographic signature (Safe docs, signature type 1).
function senderIsOwnerSignature(owner: Address): Hex {
  return concat([pad(owner, { size: 32 }), pad("0x00", { size: 32 }), "0x01"]);
}

export type SafeCall = { to: string; value: bigint; data: string };

// The owner itself sends execTransaction on its threshold-1 Safe and pays the gas.
export async function execFromOwner(safe: Address, owner: Account, call: SafeCall, label: string) {
  const hash = await walletFor(owner).writeContract({
    address: safe,
    abi: safeAbi,
    functionName: "execTransaction",
    args: [
      call.to as Address,
      call.value,
      call.data as Hex,
      0, // operation: CALL
      0n, // safeTxGas: 0 means the whole transaction reverts if the inner call fails
      0n,
      0n,
      zeroAddress,
      zeroAddress,
      senderIsOwnerSignature(owner.address),
    ],
  });
  return confirm(label, hash);
}

export async function readSafe(safe: Address, module: Address) {
  const code = await publicClient.getCode({ address: safe });
  if (!code || code === "0x") return { deployed: false as const };
  const [owners, threshold, moduleEnabled, nonce] = await Promise.all([
    publicClient.readContract({ address: safe, abi: safeAbi, functionName: "getOwners" }),
    publicClient.readContract({ address: safe, abi: safeAbi, functionName: "getThreshold" }),
    publicClient.readContract({ address: safe, abi: safeAbi, functionName: "isModuleEnabled", args: [module] }),
    publicClient.readContract({ address: safe, abi: safeAbi, functionName: "nonce" }),
  ]);
  return { deployed: true as const, owners, threshold, moduleEnabled, nonce };
}

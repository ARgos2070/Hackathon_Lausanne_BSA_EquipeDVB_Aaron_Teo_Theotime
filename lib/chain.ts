// Public chain constants shared by the browser and the server. Nothing secret here.

// Base Sepolia (testnet).
export const CHAIN_ID = BigInt(process.env.NEXT_PUBLIC_CHAIN_ID ?? "84532");
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";

// Official USDC on Base Sepolia (Circle docs, "USDC contract addresses").
export const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const USDC_DECIMALS = 6;

export const EXPLORER_TX_URL = "https://sepolia.basescan.org/tx/";

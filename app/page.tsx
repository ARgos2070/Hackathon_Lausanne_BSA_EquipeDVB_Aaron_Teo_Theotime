import { Suspense } from "react";
import { getBalance } from "@/lib/sqkeys";

async function Balance() {
  const { usdc } = await getBalance();
  return <>{usdc} USDC</>;
}

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">SQ Keys</h1>
      <div className="text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Total</p>
        <p className="text-3xl font-medium">
          <Suspense fallback="Loading…">
            <Balance />
          </Suspense>
        </p>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Base Sepolia (testnet)</p>
      </div>
    </main>
  );
}

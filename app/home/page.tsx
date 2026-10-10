"use client";

// Home (CDC.md, P3): address, USDC balance and a gasless send form.
// Minimal screen: Téo owns the design. Logic comes from lib/sqkeys.ts only.
// Texts: CDC.md, section 10.7.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EXPLORER_TX_URL } from "@/lib/chain";
import { getAccount, getBalance, sendUsdc } from "@/lib/sqkeys";

const button = "rounded-lg bg-foreground px-4 py-3 text-center font-semibold text-background disabled:opacity-50";
const input = "rounded-lg border border-zinc-400 bg-transparent px-3 py-2 text-base";
const muted = "text-sm text-zinc-600 dark:text-zinc-400";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Try again.";
}

export default function HomePage() {
  const [address, setAddress] = useState<string | null>(null);
  const [noAccount, setNoAccount] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    try {
      setBalance((await getBalance()).usdc);
      setBalanceError(null);
    } catch (err) {
      setBalanceError(messageOf(err));
    }
  }, []);

  useEffect(() => {
    getAccount()
      .then((account) => {
        setAddress(account.address);
        return refreshBalance();
      })
      .catch(() => setNoAccount(true));
  }, [refreshBalance]);

  async function handleSend(event: React.FormEvent) {
    event.preventDefault();
    setSendError(null);
    setTxHash(null);
    setSending(true);
    try {
      const result = await sendUsdc(to, amount);
      setTxHash(result.txHash);
      setAmount("");
      await refreshBalance();
    } catch (err) {
      setSendError(messageOf(err));
    } finally {
      setSending(false);
    }
  }

  if (noAccount) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-10">
        <h1 className="text-3xl font-semibold tracking-tight">SQ Keys</h1>
        <p>No account on this device. Create your phone key first.</p>
        <Link href="/create" className={button}>
          Get started
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-10">
      <section>
        <p className={muted}>Total</p>
        <p className="text-4xl font-semibold tracking-tight">{balance === null ? "…" : `${balance} USDC`}</p>
        <p className={muted}>Base Sepolia (testnet)</p>
        {balanceError && (
          <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
            {balanceError}
          </p>
        )}
        <button type="button" className="mt-2 text-sm underline" onClick={refreshBalance}>
          Refresh
        </button>
      </section>

      <section>
        <p className={muted}>Receive · Address</p>
        <p className="break-all font-mono text-sm">{address ?? "…"}</p>
      </section>

      <form className="flex flex-col gap-4" onSubmit={handleSend}>
        <h2 className="text-xl font-semibold">Send</h2>
        <label className="flex flex-col gap-1 text-sm">
          Recipient
          <input
            className={`${input} font-mono`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="0x…"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Amount
          <input
            className={input}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            required
          />
          <span className={muted}>Available: {balance ?? "…"} USDC</span>
        </label>
        <p className={muted}>Network fees: 0.00 (paid by Swissquote)</p>
        <p className={muted}>This transaction cannot be reversed once confirmed on the blockchain.</p>
        <button type="submit" className={button} disabled={sending || !address}>
          {sending ? "Sending…" : `Send ${amount || "0.00"} USDC`}
        </button>
      </form>

      {sendError && (
        <p role="alert" className="rounded-lg border border-red-600 p-3 text-sm text-red-700 dark:text-red-400">
          {sendError}
        </p>
      )}

      {txHash && (
        <section role="status" className="rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
          <p className="font-semibold">Transfer confirmed</p>
          <p>The transaction cannot be reversed.</p>
          <a className="underline" href={`${EXPLORER_TX_URL}${txHash}`} target="_blank" rel="noopener noreferrer">
            View on explorer
          </a>
        </section>
      )}
    </main>
  );
}

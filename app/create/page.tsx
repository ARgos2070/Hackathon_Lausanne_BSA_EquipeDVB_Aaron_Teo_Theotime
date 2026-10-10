"use client";

// Account setup (CDC.md, P1): phone key, Safe, recovery phrase and its check.
// Minimal screen: Téo owns the design. Logic comes from lib/sqkeys.ts only.
// Texts: CDC.md, section 10.7.

import Link from "next/link";
import { useState } from "react";
import { confirmRecoveryPhrase, createRecoveryPhrase, createWallet } from "@/lib/sqkeys";

type Step = "key" | "creating" | "ready" | "phrase" | "check" | "done";

const button = "rounded-lg bg-foreground px-4 py-3 text-center font-semibold text-background disabled:opacity-50";
const muted = "text-sm text-zinc-600 dark:text-zinc-400";

// 3 distinct word numbers between 1 and 12, in ascending order.
function pickWordNumbers(): number[] {
  const numbers = Array.from({ length: 12 }, (_, i) => i + 1);
  for (let i = numbers.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [numbers[i], numbers[j]] = [numbers[j], numbers[i]];
  }
  return numbers.slice(0, 3).sort((a, b) => a - b);
}

export default function CreatePage() {
  const [step, setStep] = useState<Step>("key");
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [shown, setShown] = useState(false);
  const [numbers, setNumbers] = useState<number[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  async function handleCreateKey() {
    setError(null);
    setStep("creating");
    try {
      const wallet = await createWallet();
      setAddress(wallet.address);
      setStep("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
      setStep("key");
    }
  }

  async function handleCreatePhrase() {
    setError(null);
    const phrase = await createRecoveryPhrase();
    setWords(phrase.words);
    setShown(false);
    setStep("phrase");
  }

  function handleWrittenDown() {
    setError(null);
    setNumbers(pickWordNumbers());
    setAnswers({});
    setStep("check");
  }

  async function handleCheck(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const ok = await confirmRecoveryPhrase(numbers.map((index) => ({ index, word: answers[index] ?? "" })));
      if (ok) setStep("done");
      else setError("These words don't match. Check what you wrote down.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Try again.");
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 py-10">
      <p className="text-sm font-semibold">Account setup</p>

      {(step === "key" || step === "creating") && (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">Create your phone key</h1>
          <p>
            This key confirms your operations. It is protected by Face ID, your fingerprint or your device
            passcode.
          </p>
          <p className="rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
            Your face and fingerprint never leave your phone. Neither the app nor Swissquote receives them.
          </p>
          <p className={muted}>
            Your phone may back up this key to your Apple or Google account. You can see this under Security.
          </p>
          <p className="text-sm font-semibold">Protected by your phone</p>
          <button type="button" className={button} onClick={handleCreateKey} disabled={step === "creating"}>
            {step === "creating" ? "Creating your account…" : error ? "Try again" : "Create my key"}
          </button>
          {step === "creating" && (
            <p className={muted} role="status">
              Your phone will ask you to confirm twice: once to create your key, once to create your account.
              Network fees: 0.00 (paid by Swissquote)
            </p>
          )}
        </>
      )}

      {step === "ready" && (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">Your account is ready</h1>
          <p>Two more steps: your recovery phrase and your guardians.</p>
          <div>
            <p className={muted}>Address · Base Sepolia (testnet)</p>
            <p className="break-all font-mono text-sm">{address}</p>
          </div>
          <button type="button" className={button} onClick={handleCreatePhrase}>
            Create my recovery phrase
          </button>
        </>
      )}

      {step === "phrase" && (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">Recovery phrase</h1>
          <p>
            Your recovery phrase is one of your account&apos;s guardians. On its own, it cannot recover your
            account.
          </p>
          <p className="font-semibold">Write it down on paper. Never take a photo of it or store it online.</p>
          {shown ? (
            <>
              <ol className="grid grid-cols-2 gap-2 font-mono text-sm">
                {words.map((word, i) => (
                  <li key={i} className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700">
                    <span className="text-zinc-500">{i + 1}.</span> {word}
                  </li>
                ))}
              </ol>
              <button type="button" className={button} onClick={handleWrittenDown}>
                I&apos;ve written down my phrase
              </button>
            </>
          ) : (
            <button type="button" className={button} onClick={() => setShown(true)}>
              Show my phrase
            </button>
          )}
        </>
      )}

      {step === "check" && (
        <form className="flex flex-col gap-5" onSubmit={handleCheck}>
          <h1 className="text-3xl font-semibold tracking-tight">Check your recovery phrase</h1>
          <p>
            Enter words no. {numbers[0]}, no. {numbers[1]} and no. {numbers[2]}.
          </p>
          {numbers.map((n) => (
            <label key={n} className="flex flex-col gap-1 text-sm">
              Word no. {n}
              <input
                className="rounded-lg border border-zinc-400 bg-transparent px-3 py-2 font-mono text-base"
                value={answers[n] ?? ""}
                onChange={(e) => setAnswers({ ...answers, [n]: e.target.value })}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                required
              />
            </label>
          ))}
          <button type="submit" className={button}>
            Continue
          </button>
          <button type="button" className="text-sm underline" onClick={() => setStep("phrase")}>
            Show my phrase
          </button>
        </form>
      )}

      {step === "done" && (
        <>
          <h1 className="text-3xl font-semibold tracking-tight">Your account is ready</h1>
          <div>
            <p className={muted}>Address · Base Sepolia (testnet)</p>
            <p className="break-all font-mono text-sm">{address}</p>
          </div>
          <Link href="/home" className={button}>
            Continue
          </Link>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-lg border border-red-600 p-3 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </main>
  );
}

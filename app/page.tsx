import Link from "next/link";

// Minimal landing page. Texts: CDC.md, section 10.7.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-16">
      <p className="text-sm font-semibold">SQ Keys</p>
      <h1 className="text-4xl font-semibold tracking-tight">Your crypto, your keys</h1>
      <ul className="flex flex-col gap-4 text-sm">
        <li>
          <p className="font-semibold">You alone control your funds</p>
          <p className="text-zinc-600 dark:text-zinc-400">No one at Swissquote can send or spend your crypto.</p>
        </li>
        <li>
          <p className="font-semibold">Your phone is your key</p>
          <p className="text-zinc-600 dark:text-zinc-400">
            Every operation is confirmed on your device with Face ID, fingerprint or device passcode.
          </p>
        </li>
        <li>
          <p className="font-semibold">Help if you lose access</p>
          <p className="text-zinc-600 dark:text-zinc-400">
            Your recovery phrase and your guardians give you back access. Swissquote can never do it alone.
          </p>
        </li>
      </ul>
      <Link
        href="/create"
        className="rounded-lg bg-foreground px-4 py-3 text-center font-semibold text-background"
      >
        Get started
      </Link>
      <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">Base Sepolia (testnet)</p>
    </main>
  );
}

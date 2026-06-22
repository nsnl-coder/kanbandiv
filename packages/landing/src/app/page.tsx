import Link from "next/link";
import { env } from "@/config/env.config";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
        <span className="rounded-full border border-neutral-800 px-3 py-1 text-xs uppercase tracking-widest text-neutral-400">
          Trello Clone
        </span>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">
          Organize anything, together.
        </h1>
        <p className="max-w-xl text-balance text-neutral-400 sm:text-lg">
          Boards, lists, and cards to keep your team in sync. Plan work, track
          progress, and ship faster.
        </p>
        <a
          href={env.appUrl}
          className="rounded-md bg-white px-6 py-3 text-sm font-medium text-neutral-950 transition hover:bg-neutral-200"
        >
          Open the app
        </a>
      </main>
      <footer className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 py-8 text-sm text-neutral-500">
        <Link href="/privacy" className="transition hover:text-neutral-300">
          Privacy Policy
        </Link>
        <Link href="/terms" className="transition hover:text-neutral-300">
          Terms of Service
        </Link>
      </footer>
    </div>
  );
}

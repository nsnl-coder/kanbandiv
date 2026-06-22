import Link from "next/link";
import type { ReactNode } from "react";

// Shared chrome for the public legal pages (privacy, terms). Matches the dark
// landing theme so Google review and visitors see consistent branding.
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-40 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Link href="/" className="font-semibold tracking-tight">
            Trello Clone
          </Link>
          <nav className="flex items-center gap-4 text-sm text-neutral-400">
            <Link href="/privacy" className="hover:text-neutral-100">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-neutral-100">
              Terms
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-neutral-500">Last updated: {updated}</p>
        <div className="mt-8 space-y-6 leading-relaxed text-neutral-300">{children}</div>
      </main>

      <footer className="border-t border-neutral-800">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-3 px-6 py-8 text-sm text-neutral-500 sm:flex-row">
          <span className="font-medium text-neutral-300">Trello Clone</span>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-neutral-100">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-neutral-100">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-neutral-100">{heading}</h2>
      {children}
    </section>
  );
}

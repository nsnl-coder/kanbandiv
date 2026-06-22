import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";

// Shared chrome for the public legal pages (privacy, terms). Mirrors the
// HomePage header/footer so Google review and users see consistent branding.
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
    <div className="min-h-[100dvh] bg-surface text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-1.5 font-semibold text-foreground">
            <LayoutDashboard className="h-5 w-5 text-indigo-600" />
            Trello Clone
          </Link>
          <nav className="flex items-center gap-4 text-sm text-foreground/70">
            <Link to="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-foreground">
              Terms
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
          {title}
        </h1>
        <p className="mt-2 text-sm text-muted">Last updated: {updated}</p>
        <div className="prose-legal mt-8 space-y-6 leading-relaxed text-foreground/80">
          {children}
        </div>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-3xl flex-col items-center justify-between gap-3 px-4 py-8 text-sm text-muted sm:flex-row">
          <span className="flex items-center gap-1.5 font-medium text-foreground/80">
            <LayoutDashboard className="h-4 w-4 text-indigo-600" />
            Trello Clone
          </span>
          <div className="flex items-center gap-5">
            <Link to="/privacy" className="hover:text-foreground">
              Privacy Policy
            </Link>
            <Link to="/terms" className="hover:text-foreground">
              Terms of Service
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

// Small typographic helpers so each page reads like a document without a
// markdown dependency.
export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-foreground">{heading}</h2>
      {children}
    </section>
  );
}

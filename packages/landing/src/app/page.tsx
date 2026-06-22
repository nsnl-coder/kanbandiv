import Link from "next/link";
import {
  LayoutDashboard,
  KanbanSquare,
  Search,
  MessageSquare,
  CheckCircle2,
  Command,
  Calendar,
  ArrowRight,
  Paperclip,
} from "lucide-react";
import { env } from "@/config/env.config";

// Public marketing home. Brand tokens match the app: indigo-600 accent, slate
// neutrals, lucide icons. Light theme locked. Motion is CSS-only (hover lifts),
// so it degrades gracefully and needs no animation dependency.

const heroColumns = [
  {
    name: "To do",
    count: 5,
    cards: [
      { title: "Define IA for new landing pages", who: "Olivia Rhye", due: "May 26", label: "Discovery", tint: "bg-sky-400", comments: 2 },
      { title: "Write copy for features section", who: "Nolan Philips", due: "May 28", label: "Content", tint: "bg-amber-400", comments: 3 },
    ],
  },
  {
    name: "In progress",
    count: 3,
    cards: [
      { title: "Design homepage hero", who: "Evan Brown", due: "May 23", label: "Design", tint: "bg-emerald-400", comments: 4 },
      { title: "Build reusable component library", who: "Zoe Wong", due: "May 27", label: "Development", tint: "bg-sky-400", comments: 6 },
    ],
  },
  {
    name: "Review",
    count: 2,
    cards: [
      { title: "Review mobile breakpoints", who: "Sophia Park", due: "May 22", label: "Design", tint: "bg-emerald-400", comments: 2 },
    ],
  },
];

const features = [
  {
    icon: KanbanSquare,
    title: "Board view",
    body: "A clear, calm overview of what matters.",
  },
  {
    icon: Search,
    title: "Instant search",
    body: "Find any card, board, or person in one keystroke.",
  },
  {
    icon: MessageSquare,
    title: "Comments",
    body: "Context stays with the work.",
  },
  {
    icon: CheckCircle2,
    title: "Checklists & labels",
    body: "Break work down and tag it at a glance.",
  },
];

const proofStats = [
  { value: "Unlimited", label: "boards", body: "No caps on projects, lists, or cards." },
  { value: "Role-based", label: "access", body: "Per-project permissions, built in." },
  { value: "Keyboard", label: "first", body: "Move fast with shortcuts that stick." },
];

const loginUrl = `${env.appUrl}/login`;
const registerUrl = `${env.appUrl}/register`;

export default function Home() {
  return (
    <div className="min-h-[100dvh] bg-surface text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-1.5 font-semibold text-foreground">
            <LayoutDashboard className="h-5 w-5 text-indigo-600" />
            Trello Clone
          </Link>
          <nav className="flex items-center gap-3 text-sm">
            <a
              href={loginUrl}
              className="rounded-lg px-3 py-2 font-medium text-foreground/70 hover:text-foreground"
            >
              Log in
            </a>
            <a
              href={registerUrl}
              className="rounded-lg bg-indigo-600 px-4 py-2 font-medium text-white transition hover:bg-indigo-700 motion-safe:hover:-translate-y-px"
            >
              Start for free
            </a>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero: top-left lead, side-rail note, board panel offset bottom-right */}
        <section className="relative overflow-hidden border-b border-border">
          <span
            aria-hidden
            className="pointer-events-none absolute left-4 top-24 hidden text-xs uppercase tracking-[0.2em] text-muted [writing-mode:vertical-rl] lg:block"
          >
            v3 · trusted workflow
          </span>
          <div className="mx-auto max-w-7xl px-4 pt-16 lg:px-12 lg:pt-24">
            <h1 className="max-w-[16ch] text-4xl font-semibold tracking-tight text-foreground md:text-6xl lg:text-7xl">
              Run every project with quiet precision.
            </h1>
            <p className="mt-5 max-w-[52ch] text-lg leading-relaxed text-foreground/70">
              A kanban system that keeps work flowing and nothing slipping.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={registerUrl}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-3 font-medium text-white transition hover:bg-indigo-700 motion-safe:hover:-translate-y-px"
              >
                Start a board
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href={loginUrl}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-5 py-3 font-medium text-foreground transition hover:bg-canvas"
              >
                See how teams use it
              </a>
            </div>

            {/* Board panel bleeds off the right edge */}
            <div className="mt-14 -mb-px lg:-mr-24">
              <div className="rounded-t-2xl border border-b-0 border-border bg-canvas shadow-sm">
                <div className="flex items-center justify-between border-b border-border px-4 py-3 text-sm">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <KanbanSquare className="h-4 w-4 text-indigo-600" />
                    Q3 Website Redesign
                  </div>
                  <span className="text-muted">4 members</span>
                </div>
                <div className="grid gap-3 p-4 sm:grid-cols-3">
                  {heroColumns.map((col) => (
                    <div key={col.name} className="flex flex-col gap-2">
                      <p className="flex items-center gap-2 px-1 text-sm font-semibold text-foreground">
                        {col.name}
                        <span className="text-muted">{col.count}</span>
                      </p>
                      {col.cards.map((c) => (
                        <div
                          key={c.title}
                          className="rounded-xl border border-border bg-surface p-3 shadow-sm"
                        >
                          <p className="text-sm font-medium text-foreground">{c.title}</p>
                          <div className="mt-2 flex items-center justify-between text-xs text-muted">
                            <span>{c.who}</span>
                            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-1.5 py-0.5 text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" />
                              {c.due}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between text-xs text-muted">
                            <span className="inline-flex items-center gap-1.5">
                              <span className={`h-2 w-2 rounded-full ${c.tint}`} />
                              {c.label}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" />
                              {c.comments}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trust bar: honest, minimalist */}
        <section className="border-b border-border bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-16 text-center">
            <p className="text-xl font-medium text-foreground">
              Built for teams who&apos;d rather ship than wrangle tools.
            </p>
            <p className="mt-2 text-sm text-muted">
              Projects, boards, roles, and search in one calm workspace.
            </p>
          </div>
        </section>

        {/* Feature bento: 4 tiles + one accent tile */}
        <section className="bg-canvas">
          <div className="mx-auto max-w-7xl px-4 py-20">
            <h2 className="text-center text-3xl font-semibold tracking-tight text-foreground md:text-5xl">
              Built to be dependable, not loud.
            </h2>
            <p className="mt-3 text-center text-lg text-foreground/70">
              Calibrated details that keep your team in flow.
            </p>
            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {features.map((f, i) => (
                <div
                  key={f.title}
                  className={`rounded-2xl border border-border bg-surface p-6 transition motion-safe:hover:-translate-y-0.5 ${
                    i === 0 ? "md:col-span-2" : ""
                  }`}
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600/10 text-indigo-600">
                    <f.icon className="h-5 w-5" />
                  </span>
                  <h3 className="mt-4 text-lg font-semibold text-foreground">{f.title}</h3>
                  <p className="mt-1 leading-relaxed text-foreground/70">{f.body}</p>
                </div>
              ))}
              {/* Accent tile */}
              <div className="rounded-2xl bg-indigo-700 p-6 text-white">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/15">
                  <Command className="h-5 w-5" />
                </span>
                <h3 className="mt-4 text-lg font-semibold">Keyboard shortcuts</h3>
                <p className="mt-1 leading-relaxed text-white/75">
                  Move faster with a command palette and shortcuts that stick.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Product showcase: card detail panel, bottom-left caption */}
        <section className="border-y border-border bg-surface">
          <div className="mx-auto grid max-w-7xl items-end gap-10 px-4 py-20 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-foreground md:text-5xl">
                Every card,
                <br />
                the full story.
              </h2>
              <a
                href={registerUrl}
                className="mt-6 inline-flex items-center gap-2 border-b-2 border-indigo-600 pb-0.5 font-medium text-indigo-700 transition hover:gap-3"
              >
                Explore a card
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>

            <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-canvas px-2 py-1 text-xs font-medium text-muted">
                    <KanbanSquare className="h-3 w-3" /> In progress
                  </span>
                  <h3 className="mt-3 text-xl font-semibold text-foreground">
                    Design homepage hero
                  </h3>
                </div>
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-0.5 text-xs text-emerald-700">
                  <Calendar className="h-3 w-3" /> May 25
                </span>
              </div>

              <p className="mt-5 text-sm font-semibold text-foreground">
                Checklist <span className="font-normal text-muted">3 / 5</span>
              </p>
              <ul className="mt-2 space-y-2 text-sm">
                {["Review brand guidelines", "Draft initial layouts", "Share with design lead"].map((t) => (
                  <li key={t} className="flex items-center gap-2 text-muted line-through">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {t}
                  </li>
                ))}
                {["Incorporate feedback", "Finalize responsive states"].map((t) => (
                  <li key={t} className="flex items-center gap-2 text-foreground/80">
                    <span className="h-4 w-4 rounded border border-border" /> {t}
                  </li>
                ))}
              </ul>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1 rounded-md bg-canvas px-2 py-1">
                  <Paperclip className="h-3 w-3" /> hero-wireframe.png
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-canvas px-2 py-1">
                  <Paperclip className="h-3 w-3" /> brand-tokens.pdf
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Proof: pull-quote + honest capability stats */}
        <section className="bg-canvas">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 lg:grid-cols-2">
            <div className="rounded-2xl border border-border bg-surface p-8">
              <span className="font-serif text-4xl leading-none text-indigo-600">&ldquo;</span>
              <p className="mt-3 text-2xl font-medium leading-snug text-foreground">
                Clarity on every project, without adding noise. The work moves and
                nothing slips through.
              </p>
              <p className="mt-6 text-sm text-muted">The idea behind every board.</p>
            </div>
            <div className="grid grid-cols-3 items-center divide-x divide-border">
              {proofStats.map((s) => (
                <div key={s.label} className="px-4 text-center">
                  <p className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
                    {s.value}
                  </p>
                  <p className="text-sm font-medium text-foreground/80">{s.label}</p>
                  <p className="mt-2 text-xs leading-relaxed text-muted">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-surface">
          <div className="mx-auto max-w-3xl px-4 py-24 text-center">
            <h2 className="text-4xl font-semibold tracking-tight text-foreground md:text-6xl">
              Bring order to the work.
            </h2>
            <a
              href={registerUrl}
              className="mt-8 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-7 py-3.5 text-lg font-medium text-white transition hover:bg-indigo-700 motion-safe:hover:-translate-y-px"
            >
              Create your first board
            </a>
            <p className="mt-4 text-sm text-muted">No setup · free to start</p>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-12 sm:flex-row sm:items-center">
          <div>
            <span className="flex items-center gap-1.5 font-semibold text-foreground">
              <LayoutDashboard className="h-5 w-5 text-indigo-600" />
              Trello Clone
            </span>
            <p className="mt-2 text-sm text-muted">
              Boards, lists, and cards for work that actually moves.
            </p>
          </div>
          <nav className="flex items-center gap-6 text-sm text-muted">
            <a href={registerUrl} className="hover:text-foreground">Get started</a>
            <a href={loginUrl} className="hover:text-foreground">Log in</a>
            <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}

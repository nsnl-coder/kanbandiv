import { Nav } from "../../components/Nav";

export function HomePage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold text-slate-800">Your boards</h1>
        <p className="mt-2 text-sm text-slate-600">Welcome back.</p>
      </main>
    </div>
  );
}

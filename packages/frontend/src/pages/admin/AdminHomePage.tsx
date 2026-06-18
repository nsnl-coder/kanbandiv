import { Nav } from "../../components/Nav";

export function AdminHomePage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-2xl font-bold text-slate-800">Admin dashboard</h1>
        <p className="mt-2 text-sm text-slate-600">Administrator area.</p>
      </main>
    </div>
  );
}

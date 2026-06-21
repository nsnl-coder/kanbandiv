import { Link, Outlet } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";

// Guest pages (login, register, password flows) share a slim branded header.
export function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="flex h-16 shrink-0 items-center border-b border-border bg-surface px-4">
        <Link to="/" className="flex items-center gap-1.5 font-semibold text-foreground">
          <LayoutDashboard className="h-5 w-5 text-indigo-600" />
          Trello Clone
        </Link>
      </header>
      <Outlet />
    </div>
  );
}

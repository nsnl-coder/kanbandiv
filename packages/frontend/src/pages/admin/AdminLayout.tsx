import { NavLink, Outlet } from "react-router-dom";
import { ShieldCheck, Users, DatabaseBackup, type LucideIcon } from "lucide-react";
import { Nav } from "../../components/Nav";
import { Can } from "../../features/rbac/components/Can";
import { Permission } from "shared";

interface AdminNavItem {
  to: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  perm: Permission;
}

const NAV_ITEMS: AdminNavItem[] = [
  {
    to: "/admin/roles",
    label: "Roles",
    hint: "Permissions & access",
    icon: ShieldCheck,
    perm: Permission.AdminRolesRead,
  },
  {
    to: "/admin/users",
    label: "Users",
    hint: "Accounts & assignments",
    icon: Users,
    perm: Permission.AdminUsersRead,
  },
  {
    to: "/admin/backup",
    label: "Backup",
    hint: "Snapshots & restore",
    icon: DatabaseBackup,
    perm: Permission.AdminBackupRead,
  },
];

const itemClass = ({ isActive }: { isActive: boolean }) =>
  `group flex items-start gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
    isActive
      ? "bg-white text-indigo-700 shadow-sm ring-1 ring-slate-200/70"
      : "text-slate-600 hover:bg-white/60 hover:text-slate-900"
  }`;

export function AdminLayout() {
  return (
    <div className="board-surface min-h-screen">
      <Nav />
      <div className="flex w-full gap-8 px-4 py-8 lg:px-8">
        <aside className="hidden w-60 shrink-0 md:block">
          <div className="sticky top-8">
            <div className="px-3 pb-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Administration
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Manage access and data
              </p>
            </div>
            <nav className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <Can key={item.to} perm={item.perm}>
                  <NavLink to={item.to} className={itemClass}>
                    {({ isActive }) => (
                      <>
                        <item.icon
                          className={`mt-0.5 h-4 w-4 shrink-0 ${
                            isActive
                              ? "text-indigo-600"
                              : "text-slate-400 group-hover:text-slate-600"
                          }`}
                        />
                        <span className="flex flex-col leading-tight">
                          <span className="font-medium">{item.label}</span>
                          <span className="text-xs text-slate-400">
                            {item.hint}
                          </span>
                        </span>
                      </>
                    )}
                  </NavLink>
                </Can>
              ))}
            </nav>
          </div>
        </aside>

        {/* Mobile: horizontal nav fallback */}
        <div className="min-w-0 flex-1">
          <nav className="mb-6 flex gap-2 overflow-x-auto md:hidden">
            {NAV_ITEMS.map((item) => (
              <Can key={item.to} perm={item.perm}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                      isActive
                        ? "bg-white text-indigo-700 ring-1 ring-slate-200"
                        : "text-slate-600 hover:bg-white/60"
                    }`
                  }
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              </Can>
            ))}
          </nav>
          <Outlet />
        </div>
      </div>
    </div>
  );
}

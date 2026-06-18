import { NavLink, Outlet } from "react-router-dom";
import { Nav } from "../../components/Nav";
import { Can } from "../../features/rbac/components/Can";
import { Permission } from "shared";

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-3 py-1.5 text-sm font-medium ${
    isActive
      ? "bg-slate-800 text-white"
      : "text-slate-600 hover:bg-slate-200 hover:text-slate-900"
  }`;

export function AdminLayout() {
  return (
    <div className="min-h-screen bg-slate-50">
      <Nav />
      <div className="mx-auto max-w-5xl p-6">
        <nav className="mb-6 flex gap-2 border-b border-slate-200 pb-3">
          <Can perm={Permission.AdminRolesRead}>
            <NavLink to="/admin/roles" className={linkClass}>
              Roles
            </NavLink>
          </Can>
          <Can perm={Permission.AdminUsersRead}>
            <NavLink to="/admin/users" className={linkClass}>
              Users
            </NavLink>
          </Can>
        </nav>
        <Outlet />
      </div>
    </div>
  );
}

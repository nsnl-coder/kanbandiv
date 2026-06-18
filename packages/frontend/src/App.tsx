import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Permission } from "shared";
import { useAuthStore } from "./hooks/useAuthStore";
import { refreshSession } from "./lib/trpc";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PermissionRoute } from "./components/PermissionRoute";
import { GuestRoute } from "./components/GuestRoute";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { VerifyEmailPage } from "./pages/auth/VerifyEmailPage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage";
import { ChangePasswordPage } from "./pages/user/ChangePasswordPage";
import { HomePage } from "./pages/user/HomePage";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { RolesListPage } from "./pages/admin/roles/RolesListPage";
import { RoleFormPage } from "./pages/admin/roles/RoleFormPage";
import { UsersListPage } from "./pages/admin/users/UsersListPage";
import { useCan } from "./features/rbac/hooks/useCan";
import { ADMIN_READ_PERMS } from "./features/rbac/constants";

// /admin landing: send the user to the first admin section they can read.
function AdminIndex() {
  const canRoles = useCan(Permission.AdminRolesRead);
  return <Navigate to={canRoles ? "/admin/roles" : "/admin/users"} replace />;
}

// One-shot silent refresh on a full page reload, to re-hydrate the in-memory
// store from the httpOnly refresh cookie. Module-level guard avoids a duplicate
// call under React StrictMode.
let attemptedMountRefresh = false;

export function App() {
  const user = useAuthStore((s) => s.user);
  const [hydrating, setHydrating] = useState(
    () => user === null && !attemptedMountRefresh,
  );

  useEffect(() => {
    if (attemptedMountRefresh || user !== null) {
      setHydrating(false);
      return;
    }
    attemptedMountRefresh = true;
    let active = true;
    refreshSession().finally(() => {
      if (active) setHydrating(false);
    });
    return () => {
      active = false;
    };
  }, [user]);

  if (hydrating) return null;

  return (
    <Routes>
      <Route element={<GuestRoute />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings/password" element={<ChangePasswordPage />} />
      </Route>

      <Route
        path="/admin"
        element={<PermissionRoute anyOf={ADMIN_READ_PERMS} />}
      >
        <Route element={<AdminLayout />}>
          <Route index element={<AdminIndex />} />
          <Route element={<PermissionRoute perm={Permission.AdminRolesRead} />}>
            <Route path="roles" element={<RolesListPage />} />
            <Route path="roles/:roleId" element={<RoleFormPage />} />
          </Route>
          <Route element={<PermissionRoute perm={Permission.AdminRolesManage} />}>
            <Route path="roles/new" element={<RoleFormPage />} />
          </Route>
          <Route element={<PermissionRoute perm={Permission.AdminUsersRead} />}>
            <Route path="users" element={<UsersListPage />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

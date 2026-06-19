import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Permission } from "shared";
import { useAuthStore } from "./hooks/useAuthStore";
import { refreshSession } from "./lib/trpc";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { PermissionRoute } from "./components/PermissionRoute";
import { GuestRoute } from "./components/GuestRoute";
import { AppLayout } from "./components/AppLayout";
import { AuthLayout } from "./components/AuthLayout";
import { Toaster } from "./components/Toaster";
import { HomePage } from "./pages/HomePage";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { VerifyEmailPage } from "./pages/auth/VerifyEmailPage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage";
import { ProjectsLanding } from "./pages/user/projects/ProjectsLanding";
import { ProjectFormPage } from "./pages/user/projects/ProjectFormPage";
import { ProjectDetailPage } from "./pages/user/projects/ProjectDetailPage";
import { BoardFormPage } from "./pages/user/projects/BoardFormPage";
import { BoardDetailPage } from "./pages/user/projects/BoardDetailPage";
import { AdminLayout } from "./pages/admin/AdminLayout";
import { RolesListPage } from "./pages/admin/roles/RolesListPage";
import { RoleFormPage } from "./pages/admin/roles/RoleFormPage";
import { UsersListPage } from "./pages/admin/users/UsersListPage";
import { useCan } from "./features/rbac/hooks/useCan";
import { ADMIN_READ_PERMS } from "./features/rbac/constants";

// Public landing at "/": marketing home for guests, app for signed-in users.
function HomeIndex() {
  const user = useAuthStore((s) => s.user);
  return user ? <Navigate to="/projects" replace /> : <HomePage />;
}

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
    <>
      <Routes>
      <Route path="/" element={<HomeIndex />} />

      <Route element={<GuestRoute />}>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
        </Route>
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/projects" element={<ProjectsLanding />} />
          <Route path="/projects/new" element={<ProjectFormPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/projects/:id/boards/:boardId" element={<BoardDetailPage />} />
          <Route path="/projects/:id/boards/:boardId/edit" element={<BoardFormPage />} />
        </Route>
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
      <Toaster />
    </>
  );
}

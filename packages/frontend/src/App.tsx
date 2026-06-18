import { useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./hooks/useAuthStore";
import { refreshSession } from "./lib/trpc";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { GuestRoute } from "./components/GuestRoute";
import { RegisterPage } from "./pages/auth/RegisterPage";
import { LoginPage } from "./pages/auth/LoginPage";
import { VerifyEmailPage } from "./pages/auth/VerifyEmailPage";
import { ForgotPasswordPage } from "./pages/auth/ForgotPasswordPage";
import { ResetPasswordPage } from "./pages/auth/ResetPasswordPage";
import { ChangePasswordPage } from "./pages/user/ChangePasswordPage";
import { HomePage } from "./pages/user/HomePage";
import { AdminHomePage } from "./pages/admin/AdminHomePage";

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

      <Route element={<ProtectedRoute role="admin" />}>
        <Route path="/admin" element={<AdminHomePage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

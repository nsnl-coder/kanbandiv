import { useState } from "react";
import { KeyRound } from "lucide-react";
import { ChangePasswordModal } from "../../features/auth/components/ChangePasswordModal";
import { NotificationSettings } from "../../features/notification/components/NotificationSettings";

export function SettingsPage() {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="mx-auto w-full max-w-2xl space-y-8 p-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>

      <NotificationSettings />

      <section>
        <h2 className="text-sm font-semibold text-foreground">Security</h2>
        <button
          type="button"
          onClick={() => setShowPassword(true)}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground/80 hover:bg-surface-muted"
        >
          <KeyRound className="h-4 w-4" />
          Change password
        </button>
      </section>

      {showPassword ? (
        <ChangePasswordModal onClose={() => setShowPassword(false)} />
      ) : null}
    </main>
  );
}

import { flushSync } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { UserCheck } from "lucide-react";
import { useTRPC } from "../lib/trpc";
import { useAuthStore } from "../hooks/useAuthStore";

// Shown only while a superuser is impersonating another account. Lets them
// return to their own session. Hidden otherwise.
export function ImpersonationBanner() {
  const trpc = useTRPC();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);

  const stop = useMutation(
    trpc.auth.stopImpersonation.mutationOptions({
      onSuccess: (actor) => {
        flushSync(() => setAuth(actor));
        queryClient.clear();
        navigate("/admin/users", { replace: true });
      },
    }),
  );

  if (!user?.impersonator) return null;

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-3 bg-amber-500 px-4 py-1.5 text-xs font-medium text-white"
    >
      <UserCheck className="h-3.5 w-3.5" />
      <span>
        Viewing as <strong>{user.email}</strong> (impersonated by{" "}
        {user.impersonator.email})
      </span>
      <button
        type="button"
        onClick={() => stop.mutate({})}
        disabled={stop.isPending}
        className="rounded-md bg-white/20 px-2 py-0.5 font-semibold transition hover:bg-white/30 disabled:opacity-50"
      >
        Stop impersonating
      </button>
    </div>
  );
}

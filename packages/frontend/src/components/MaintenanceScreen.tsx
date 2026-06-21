import { Wrench } from "lucide-react";
import { useMaintenanceStore } from "../hooks/useMaintenanceStore";

// App-wide overlay shown to non-exempt users while the backend is in maintenance
// mode (driven by the maintenanceLink in lib/trpc).
export function MaintenanceScreen() {
  const active = useMaintenanceStore((s) => s.active);
  if (!active) return null;

  return (
    <div
      role="alert"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-900/95 p-6 text-center text-white"
    >
      <Wrench className="h-10 w-10 text-amber-400" />
      <h1 className="text-2xl font-bold">Under maintenance</h1>
      <p className="max-w-md text-muted">
        We&apos;re performing scheduled maintenance. The app will be back shortly.
        Please check again in a few minutes.
      </p>
    </div>
  );
}

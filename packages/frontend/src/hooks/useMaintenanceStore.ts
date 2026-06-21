import { create } from "zustand";

// Set when any tRPC call returns SERVICE_UNAVAILABLE/MAINTENANCE (the backend
// maintenance guard), cleared on the next successful call. Backup admins are
// exempt server-side, so their calls succeed and they never see the screen.
interface MaintenanceState {
  active: boolean;
  setActive: (active: boolean) => void;
}

export const useMaintenanceStore = create<MaintenanceState>((set) => ({
  active: false,
  setActive: (active) => set({ active }),
}));

export const maintenanceStore = {
  setActive: (active: boolean) => useMaintenanceStore.getState().setActive(active),
};

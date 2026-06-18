import { create } from "zustand";
import type { PublicUser } from "shared";

// Access + refresh tokens live in httpOnly cookies (never readable by JS).
// The store only mirrors the authenticated user, re-hydrated via auth.refresh.
interface AuthState {
  user: PublicUser | null;
  setAuth: (user: PublicUser) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  setAuth: (user) => set({ user }),
  clearAuth: () => set({ user: null }),
}));

// Non-React accessors for use outside components (e.g. the tRPC link).
export const authStore = {
  getUser: () => useAuthStore.getState().user,
  isAuthenticated: () => useAuthStore.getState().user !== null,
  setAuth: (user: PublicUser) => useAuthStore.getState().setAuth(user),
  clearAuth: () => useAuthStore.getState().clearAuth(),
};

if (import.meta.env.DEV) {
  (window as unknown as { __authStore: typeof useAuthStore }).__authStore =
    useAuthStore;
}

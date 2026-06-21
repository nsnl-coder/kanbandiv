import { create } from "zustand";

// Surfaced realtime (SSE) health. Each stream reports itself; the banner shows
// while any tracked stream is down. Streams flip online on `onopen` and offline
// once errors persist past the reconnect threshold.
interface ConnectionState {
  online: boolean;
  setOnline: (online: boolean) => void;
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  online: true,
  setOnline: (online) => set({ online }),
}));

// Non-hook accessor for use inside long-lived SSE handlers (no re-render needed).
export const connectionStore = {
  setOnline: (online: boolean) => useConnectionStore.setState({ online }),
};

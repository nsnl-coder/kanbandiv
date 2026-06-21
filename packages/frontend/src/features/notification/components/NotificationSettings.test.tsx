import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { NotificationPref } from "shared";

const h = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  mutateCalls: {} as Record<string, unknown[]>,
  setData: [] as unknown[],
  loading: {} as Record<string, boolean>,
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    queryOptions: (input?: unknown, opts: Record<string, unknown> = {}) => ({
      queryKey: [path, input],
      ...opts,
    }),
    queryKey: (input?: unknown) => [path, input],
    mutationOptions: (opts: Record<string, unknown> = {}) => ({ ...opts, _mutationKey: path }),
  });
  const proxy = new Proxy({}, { get: () => new Proxy({}, { get: (_t, ep: string) => leaf(ep) }) });
  return { useTRPC: () => proxy };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => {
    const key = opts.queryKey[0] as string;
    return { data: h.queryData[key], isLoading: h.loading[key] ?? false, error: null };
  },
  useMutation: (opts: { _mutationKey: string }) => ({
    mutate: (vars: unknown) => {
      (h.mutateCalls[opts._mutationKey] ??= []).push(vars);
    },
    isPending: false,
    error: null,
  }),
  useQueryClient: () => ({
    getQueryData: () => h.queryData.prefsList,
    setQueryData: (_k: unknown, updater: unknown) => h.setData.push(updater),
    invalidateQueries: () => {},
  }),
}));

const { NotificationSettings } = await import("./NotificationSettings");

const allOn: NotificationPref[] = [
  { type: "MENTION", inApp: true, email: true },
  { type: "CARD_ASSIGNED", inApp: true, email: true },
  { type: "CARD_DUE_SOON", inApp: true, email: true },
];

beforeEach(() => {
  h.queryData = {};
  h.mutateCalls = {};
  h.setData = [];
  h.loading = {};
});

describe("NotificationSettings", () => {
  it("renders a row per notification type with both channel toggles", () => {
    h.queryData = { prefsList: allOn };
    render(<NotificationSettings />);
    expect(screen.getByText("Mentions")).toBeInTheDocument();
    expect(screen.getByText("Card assignments")).toBeInTheDocument();
    expect(screen.getByText("Due-date reminders")).toBeInTheDocument();
    expect(screen.getByLabelText("Mentions in-app")).toBeChecked();
    expect(screen.getByLabelText("Mentions email")).toBeChecked();
  });

  it("toggling email calls prefsSet with the flipped channel", async () => {
    h.queryData = { prefsList: allOn };
    const u = userEvent.setup();
    render(<NotificationSettings />);
    await u.click(screen.getByLabelText("Mentions email"));
    expect(h.mutateCalls.prefsSet).toContainEqual({
      type: "MENTION",
      inApp: true,
      email: false,
    });
  });

  it("shows a loading state", () => {
    h.loading = { prefsList: true };
    render(<NotificationSettings />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});

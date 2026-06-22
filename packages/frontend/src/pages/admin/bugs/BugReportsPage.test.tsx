import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Permission, type BugReport, type PublicUser } from "shared";
import { useAuthStore } from "../../../hooks/useAuthStore";

const h = vi.hoisted(() => ({
  lastInput: null as Record<string, unknown> | null,
  page: { items: [] as BugReport[], nextOffset: null as number | null },
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    queryOptions: (input: unknown) => ({ queryKey: [path, input], _input: input }),
    queryKey: (input?: unknown) => [path, input],
    mutationOptions: (opts: Record<string, unknown> = {}) => ({ ...opts, _key: path }),
  });
  const ns = new Proxy({}, { get: (_t, ep: string) => leaf(ep) });
  return { useTRPC: () => ({ bugReports: ns }) };
});

vi.mock("@tanstack/react-query", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (opts: { _input: Record<string, unknown> }) => {
      h.lastInput = opts._input;
      return { data: h.page, isLoading: false, error: null };
    },
    useMutation: (opts: { onSuccess?: () => void }) => ({
      mutate: () => opts.onSuccess?.(),
      isPending: false,
      error: null,
    }),
    useQueryClient: () => ({ invalidateQueries: () => {} }),
  };
});

const { BugReportsPage } = await import("./BugReportsPage");

function makeReport(over: Partial<BugReport> = {}): BugReport {
  return {
    id: "b1",
    reporterId: "u1",
    reporterEmail: "rep@x.io",
    title: "Header overlaps",
    description: "The header overlaps the content.",
    severity: "high",
    status: "open",
    pageUrl: "/projects/1",
    userAgent: "vitest",
    resolution: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    ...over,
  };
}

const manager: PublicUser = {
  id: "su",
  email: "su@x.io",
  isSuperuser: false,
  roleId: null,
  emailVerified: true,
  permissions: [Permission.AdminBugsRead, Permission.AdminBugsManage],
};

const readOnly: PublicUser = { ...manager, permissions: [Permission.AdminBugsRead] };

beforeEach(() => {
  h.lastInput = null;
  h.page = { items: [makeReport()], nextOffset: 20 };
  useAuthStore.getState().setAuth(manager);
});

describe("BugReportsPage", () => {
  it("renders rows from the list query", () => {
    render(<BugReportsPage />);
    expect(screen.getByText("Header overlaps")).toBeInTheDocument();
    expect(screen.getByText("rep@x.io")).toBeInTheDocument();
  });

  it("status + severity filters drive the query input", async () => {
    const user = userEvent.setup();
    render(<BugReportsPage />);
    await user.selectOptions(screen.getByLabelText("Filter by status"), "resolved");
    expect(h.lastInput).toMatchObject({ status: "resolved" });
    await user.selectOptions(screen.getByLabelText("Filter by severity"), "critical");
    expect(h.lastInput).toMatchObject({ severity: "critical" });
  });

  it("pagination advances the offset using nextOffset", async () => {
    const user = userEvent.setup();
    render(<BugReportsPage />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(h.lastInput).toMatchObject({ offset: 20 });
  });

  it("hides edit controls without AdminBugsManage", async () => {
    useAuthStore.getState().setAuth(readOnly);
    const user = userEvent.setup();
    render(<BugReportsPage />);
    await user.click(screen.getByText("Header overlaps"));
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("shows edit controls with AdminBugsManage", async () => {
    const user = userEvent.setup();
    render(<BugReportsPage />);
    await user.click(screen.getByText("Header overlaps"));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });
});

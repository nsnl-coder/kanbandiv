import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Permission, type BugReport, type PublicUser } from "shared";
import { useAuthStore } from "../../../hooks/useAuthStore";

const h = vi.hoisted(() => ({
  updateCalls: [] as unknown[],
  removeCalls: [] as unknown[],
  removeAttachmentCalls: [] as unknown[],
  invalidated: [] as unknown[],
  attachments: [] as unknown[],
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    queryKey: (input?: unknown) => [path, input],
    queryOptions: (input?: unknown) => ({ _key: path, input }),
    mutationOptions: (opts: Record<string, unknown> = {}) => ({ ...opts, _key: path }),
  });
  const ns = new Proxy({}, { get: (_t, ep: string) => leaf(ep) });
  return { useTRPC: () => ({ bugReports: ns }) };
});

vi.mock("@tanstack/react-query", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: (opts: { onSuccess?: () => void; _key?: string }) => ({
      mutate: (vars: unknown) => {
        if (opts._key === "update") h.updateCalls.push(vars);
        if (opts._key === "remove") h.removeCalls.push(vars);
        if (opts._key === "removeAttachment") h.removeAttachmentCalls.push(vars);
        opts.onSuccess?.();
      },
      isPending: false,
      error: null,
    }),
    useQuery: () => ({ data: h.attachments, isLoading: false }),
    useQueryClient: () => ({
      invalidateQueries: (a: unknown) => h.invalidated.push(a),
    }),
  };
});

const { BugReportDetailModal } = await import("./BugReportDetailModal");

const report: BugReport = {
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
};

const manager: PublicUser = {
  id: "su",
  email: "su@x.io",
  isSuperuser: false,
  roleId: null,
  emailVerified: true,
  permissions: [Permission.AdminBugsRead, Permission.AdminBugsManage],
};

beforeEach(() => {
  h.updateCalls = [];
  h.removeCalls = [];
  h.removeAttachmentCalls = [];
  h.invalidated = [];
  h.attachments = [];
  useAuthStore.getState().setAuth(manager);
});

describe("BugReportDetailModal", () => {
  it("shows the full report details", () => {
    render(<BugReportDetailModal report={report} open onClose={() => {}} />);
    expect(screen.getByText("The header overlaps the content.")).toBeInTheDocument();
    expect(screen.getByText("rep@x.io")).toBeInTheDocument();
    expect(screen.getByText("/projects/1")).toBeInTheDocument();
    expect(screen.getByText("vitest")).toBeInTheDocument();
  });

  it("Save calls update with the changed fields and invalidates", async () => {
    const user = userEvent.setup();
    render(<BugReportDetailModal report={report} open onClose={() => {}} />);
    await user.selectOptions(screen.getByLabelText("Status"), "resolved");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(h.updateCalls[0]).toMatchObject({ id: "b1", status: "resolved", severity: "high" });
    expect(h.invalidated.length).toBeGreaterThan(0);
  });

  it("Delete calls remove after confirm and invalidates", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<BugReportDetailModal report={report} open onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(h.removeCalls[0]).toEqual({ id: "b1" });
    expect(h.invalidated.length).toBeGreaterThan(0);
    confirmSpy.mockRestore();
  });

  it("Delete is skipped when confirm is cancelled", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    render(<BugReportDetailModal report={report} open onClose={() => {}} />);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(h.removeCalls).toHaveLength(0);
    confirmSpy.mockRestore();
  });

  it("lists attachments with a download link and deletes one", async () => {
    h.attachments = [
      {
        id: "att1",
        bugReportId: "b1",
        uploaderId: "u1",
        filename: "screen.png",
        mimeType: "image/png",
        sizeBytes: 2048,
        createdAt: new Date(),
        downloadUrl: "/api/bug-report-attachments/att1/download",
      },
    ];
    const user = userEvent.setup();
    render(<BugReportDetailModal report={report} open onClose={() => {}} />);
    const link = screen.getByRole("link", { name: /screen\.png/ });
    expect(link).toHaveAttribute("href", "/api/bug-report-attachments/att1/download");
    await user.click(screen.getByRole("button", { name: "delete screen.png" }));
    expect(h.removeAttachmentCalls[0]).toEqual({ id: "att1" });
  });
});

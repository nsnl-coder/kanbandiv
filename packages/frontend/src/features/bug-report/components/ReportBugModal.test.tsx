import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  mutateCalls: [] as unknown[],
  toasts: [] as string[],
  error: null as unknown,
  uploads: [] as { bugReportId: string; file: File }[],
  uploadError: null as unknown,
}));

vi.mock("../uploadBugReportAttachment", () => ({
  uploadBugReportAttachment: async (args: { bugReportId: string; file: File }) => {
    if (h.uploadError) throw h.uploadError;
    h.uploads.push(args);
    return { id: "a1" };
  },
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    mutationOptions: (opts: Record<string, unknown> = {}) => ({ ...opts, _key: path }),
  });
  const ns = new Proxy({}, { get: (_t, ep: string) => leaf(ep) });
  return { useTRPC: () => ({ bugReports: ns }) };
});

vi.mock("@tanstack/react-query", async (orig) => {
  const actual = await orig<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useMutation: (opts: { onSuccess?: () => void }) => ({
      mutate: (vars: unknown) => {
        h.mutateCalls.push(vars);
        if (!h.error) opts.onSuccess?.();
      },
      mutateAsync: async (vars: unknown) => {
        h.mutateCalls.push(vars);
        if (h.error) throw h.error;
        return { id: "new-report-id" };
      },
      isPending: false,
      error: h.error,
    }),
  };
});

vi.mock("../../../hooks/useToastStore", () => ({
  useToastStore: (sel: (s: { add: (m: string) => void }) => unknown) =>
    sel({ add: (m: string) => h.toasts.push(m) }),
}));

const { ReportBugModal } = await import("./ReportBugModal");

function renderModal(path = "/projects/1?x=2") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ReportBugModal open onClose={() => {}} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.mutateCalls = [];
  h.toasts = [];
  h.error = null;
  h.uploads = [];
  h.uploadError = null;
});

describe("ReportBugModal", () => {
  it("renders the form fields", () => {
    renderModal();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Description")).toBeInTheDocument();
    expect(screen.getByLabelText("Severity")).toBeInTheDocument();
  });

  it("blocks submit when title and description are empty", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() => expect(h.mutateCalls).toHaveLength(0));
  });

  it("submits with pageUrl from the router location and toasts on success", async () => {
    const user = userEvent.setup();
    renderModal("/boards/9?card=3");
    await user.type(screen.getByLabelText("Title"), "Broken button");
    await user.type(screen.getByLabelText("Description"), "It does not click");
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() => expect(h.mutateCalls).toHaveLength(1));
    expect(h.mutateCalls[0]).toMatchObject({
      title: "Broken button",
      description: "It does not click",
      severity: "medium",
      pageUrl: "/boards/9?card=3",
    });
    expect(h.toasts).toContain("Bug reported, thanks");
  });

  it("uploads attached files to the created report after submit", async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText("Title"), "Broken button");
    await user.type(screen.getByLabelText("Description"), "It does not click");
    const file = new File(["data"], "shot.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("attach files"), file);
    expect(screen.getByText(/shot\.png/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() => expect(h.uploads).toHaveLength(1));
    expect(h.uploads[0]).toMatchObject({ bugReportId: "new-report-id" });
    expect(h.uploads[0].file.name).toBe("shot.png");
  });

  it("shows the mapped message on a server error", async () => {
    const { TRPCClientError } = await import("@trpc/client");
    h.error = new TRPCClientError("NOT_FOUND");
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByLabelText("Title"), "Broken button");
    await user.type(screen.getByLabelText("Description"), "It does not click");
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    expect(screen.getByText("That bug report no longer exists.")).toBeInTheDocument();
  });
});

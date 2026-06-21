import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Attachment, BoardData } from "shared";

const h = vi.hoisted(() => ({
  queryData: {} as Record<string, unknown>,
  mutateCalls: {} as Record<string, unknown[]>,
  store: new Map<string, unknown>(),
  failDelete: false,
}));

vi.mock("../../../lib/trpc", () => {
  const leaf = (path: string) => ({
    queryOptions: (input: unknown) => ({ queryKey: [path, input] }),
    queryKey: (input?: unknown) => [path, input],
    mutationOptions: (opts: Record<string, unknown> = {}) => ({ ...opts, _mutationKey: path }),
  });
  const proxy = new Proxy({}, { get: () => new Proxy({}, { get: (_t, ep: string) => leaf(ep) }) });
  return { useTRPC: () => proxy };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey: unknown[] }) => ({
    data: h.queryData[opts.queryKey[0] as string],
    isLoading: false,
    error: null,
  }),
  useMutation: (opts: { _mutationKey: string }) => ({
    mutate: (vars: unknown, runtime?: { onSuccess?: () => void; onError?: () => void }) => {
      (h.mutateCalls[opts._mutationKey] ??= []).push(vars);
      if (opts._mutationKey === "delete" && h.failDelete) runtime?.onError?.();
      else runtime?.onSuccess?.();
    },
    isPending: false,
    error: null,
  }),
  useQueryClient: () => ({
    invalidateQueries: () => {},
    setQueryData: (key: unknown[], updater: unknown) => {
      const k = key[0] as string;
      const prev = h.store.get(k);
      const next = typeof updater === "function" ? (updater as (p: unknown) => unknown)(prev) : updater;
      h.store.set(k, next);
    },
    getQueryData: (key: unknown[]) => h.store.get(key[0] as string),
  }),
}));

const { AttachmentList } = await import("./AttachmentList");

function makeAttachments(): Attachment[] {
  return [
    {
      id: "a1",
      cardId: "k1",
      uploaderId: "u1",
      filename: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 2048,
      createdAt: new Date(),
      downloadUrl: "/api/attachments/a1/download",
    },
  ];
}

function boardData(): BoardData {
  return { columns: [{ cards: [{ id: "k1", attachmentCount: 1 }] }] } as unknown as BoardData;
}

beforeEach(() => {
  h.queryData = { list: makeAttachments() };
  h.mutateCalls = {};
  h.store = new Map<string, unknown>([
    ["getData", boardData()],
    ["list", makeAttachments()],
  ]);
  h.failDelete = false;
});

function renderList(props: Partial<{ canEdit: boolean; currentUserId: string; isOwner: boolean }> = {}) {
  return render(
    <AttachmentList
      boardId="b1"
      cardId="k1"
      canEdit={props.canEdit ?? true}
      currentUserId={props.currentUserId ?? "u1"}
      isOwner={props.isOwner ?? false}
    />,
  );
}

describe("AttachmentList", () => {
  it("renders name, formatted size and download href", () => {
    renderList();
    const link = screen.getByText("report.pdf") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/attachments/a1/download");
    expect(screen.getByText("2.0 KB")).toBeInTheDocument();
  });

  it("deletes: optimistically removes row and decrements count", async () => {
    const u = userEvent.setup();
    renderList();
    await u.click(screen.getByLabelText("delete report.pdf"));
    expect(h.mutateCalls.delete).toContainEqual({ id: "a1" });
    expect(h.store.get("list")).toEqual([]);
    const data = h.store.get("getData") as BoardData;
    expect(data.columns[0].cards[0].attachmentCount).toBe(0);
  });

  it("restores on delete error", async () => {
    h.failDelete = true;
    const u = userEvent.setup();
    renderList();
    await u.click(screen.getByLabelText("delete report.pdf"));
    expect((h.store.get("list") as Attachment[]).length).toBe(1);
    const data = h.store.get("getData") as BoardData;
    expect(data.columns[0].cards[0].attachmentCount).toBe(1);
  });

  it("hides delete when neither uploader nor owner", () => {
    renderList({ currentUserId: "other", isOwner: false });
    expect(screen.queryByLabelText("delete report.pdf")).toBeNull();
  });

  it("shows delete for the board owner", () => {
    renderList({ currentUserId: "other", isOwner: true });
    expect(screen.getByLabelText("delete report.pdf")).toBeInTheDocument();
  });

  it("hides upload when canEdit is false", () => {
    renderList({ canEdit: false });
    expect(screen.queryByLabelText("upload attachment")).toBeNull();
  });

  it("empty state when no attachments", () => {
    h.queryData = { list: [] };
    renderList();
    expect(screen.getByText("No attachments yet.")).toBeInTheDocument();
  });
});

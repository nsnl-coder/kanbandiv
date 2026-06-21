import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ATTACHMENT_MAX_BYTES } from "shared";
import type { BoardData } from "shared";

const h = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  upload: vi.fn(),
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

vi.mock("../uploadAttachment", () => ({
  uploadAttachment: (args: unknown) => h.upload(args),
}));

const { AttachmentUpload } = await import("./AttachmentUpload");

function boardData(): BoardData {
  return { columns: [{ cards: [{ id: "k1", attachmentCount: 0 }] }] } as unknown as BoardData;
}

function file(name: string, type: string, size: number): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

beforeEach(() => {
  h.store = new Map<string, unknown>([["getData", boardData()]]);
  h.upload = vi.fn();
});

function renderUpload() {
  return render(<AttachmentUpload boardId="b1" cardId="k1" />);
}

function count(): number {
  return (h.store.get("getData") as BoardData).columns[0].cards[0].attachmentCount;
}

describe("AttachmentUpload", () => {
  it("rejects an over-cap file client-side with no request", async () => {
    const u = userEvent.setup();
    renderUpload();
    await u.upload(
      screen.getByLabelText("upload attachment"),
      file("big.pdf", "application/pdf", ATTACHMENT_MAX_BYTES + 1),
    );
    expect(screen.getByText("That file is too large.")).toBeInTheDocument();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("rejects a disallowed type client-side with no request", async () => {
    renderUpload();
    const input = screen.getByLabelText("upload attachment") as HTMLInputElement;
    // fireEvent bypasses the accept filter to exercise the JS guard directly.
    fireEvent.change(input, { target: { files: [file("evil.svg", "image/svg+xml", 10)] } });
    expect(await screen.findByText("That file type is not allowed.")).toBeInTheDocument();
    expect(h.upload).not.toHaveBeenCalled();
  });

  it("uploads a valid file and bumps the count", async () => {
    h.upload.mockResolvedValue({
      id: "a1",
      cardId: "k1",
      uploaderId: "u1",
      filename: "ok.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      createdAt: new Date(),
      downloadUrl: "/api/attachments/a1/download",
    });
    const u = userEvent.setup();
    renderUpload();
    await u.upload(screen.getByLabelText("upload attachment"), file("ok.pdf", "application/pdf", 10));
    await waitFor(() => expect(h.upload).toHaveBeenCalled());
    expect(count()).toBe(1);
  });

  it("rolls back the count and shows STORAGE_UNAVAILABLE on 503", async () => {
    h.upload.mockRejectedValue("STORAGE_UNAVAILABLE");
    const u = userEvent.setup();
    renderUpload();
    await u.upload(screen.getByLabelText("upload attachment"), file("ok.pdf", "application/pdf", 10));
    await waitFor(() =>
      expect(
        screen.getByText("File storage is unavailable. Please try again later."),
      ).toBeInTheDocument(),
    );
    expect(count()).toBe(0);
  });
});

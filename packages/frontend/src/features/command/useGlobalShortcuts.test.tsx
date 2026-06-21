import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => h.navigate };
});

const { useGlobalShortcuts } = await import("./useGlobalShortcuts");
const { useCommandStore } = await import("./useCommandStore");
const { useSearchStore } = await import("../../hooks/useSearchStore");
const { useShortcutHelpStore } = await import("./useShortcutHelpStore");
const { useBoardActionsStore } = await import("./useBoardActionsStore");

function Harness() {
  useGlobalShortcuts();
  return <input aria-label="field" />;
}

function mount() {
  return render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
}

function key(init: KeyboardEventInit) {
  return fireEvent.keyDown(window, init);
}

beforeEach(() => {
  h.navigate = vi.fn();
  useCommandStore.setState({ open: false });
  useSearchStore.setState({ open: false });
  useShortcutHelpStore.setState({ open: false });
  useBoardActionsStore.setState({ ctx: null, handlers: null });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGlobalShortcuts", () => {
  it("Cmd/Ctrl+P opens command palette + preventDefault, leaves search closed", () => {
    mount();
    const ev = new KeyboardEvent("keydown", { key: "p", metaKey: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(useCommandStore.getState().open).toBe(true);
    expect(useSearchStore.getState().open).toBe(false);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("Cmd/Ctrl+K still opens search (moved handler), leaves palette closed", () => {
    mount();
    key({ key: "k", ctrlKey: true });
    expect(useSearchStore.getState().open).toBe(true);
    expect(useCommandStore.getState().open).toBe(false);
  });

  it("? opens help", () => {
    mount();
    key({ key: "?" });
    expect(useShortcutHelpStore.getState().open).toBe(true);
  });

  it("/ opens search", () => {
    mount();
    key({ key: "/" });
    expect(useSearchStore.getState().open).toBe(true);
  });

  it("bare c/b/g/?// in an input do nothing", () => {
    const { getByLabelText } = mount();
    const input = getByLabelText("field");
    for (const k of ["c", "b", "g", "?", "/"]) {
      fireEvent.keyDown(input, { key: k });
    }
    expect(useSearchStore.getState().open).toBe(false);
    expect(useShortcutHelpStore.getState().open).toBe(false);
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("c runs newCard only when ctx.canEdit; no-op when ctx null", () => {
    mount();
    key({ key: "c" });
    // ctx null -> nothing.
    const newCard = vi.fn();
    useBoardActionsStore.getState().register(
      { projectId: "p1", boardId: "b1", boardName: "B", canEdit: true, isOwner: false },
      {
        setView: vi.fn(), openArchived: vi.fn(), openHistory: vi.fn(),
        openLabels: vi.fn(), openTemplates: vi.fn(), openAccess: vi.fn(), clearFilters: vi.fn(), newCard,
      },
    );
    key({ key: "c" });
    expect(newCard).toHaveBeenCalledTimes(1);
  });

  it("c is a no-op when canEdit is false", () => {
    const newCard = vi.fn();
    useBoardActionsStore.getState().register(
      { projectId: "p1", boardId: "b1", boardName: "B", canEdit: false, isOwner: false },
      {
        setView: vi.fn(), openArchived: vi.fn(), openHistory: vi.fn(),
        openLabels: vi.fn(), openTemplates: vi.fn(), openAccess: vi.fn(), clearFilters: vi.fn(), newCard,
      },
    );
    mount();
    key({ key: "c" });
    expect(newCard).not.toHaveBeenCalled();
  });

  it("b navigates to the current project when ctx set", () => {
    useBoardActionsStore.getState().register(
      { projectId: "p7", boardId: "b1", boardName: "B", canEdit: true, isOwner: true },
      {
        setView: vi.fn(), openArchived: vi.fn(), openHistory: vi.fn(),
        openLabels: vi.fn(), openTemplates: vi.fn(), openAccess: vi.fn(), clearFilters: vi.fn(), newCard: vi.fn(),
      },
    );
    mount();
    key({ key: "b" });
    expect(h.navigate).toHaveBeenCalledWith("/projects/p7");
  });

  it("g then p navigates to /projects", () => {
    mount();
    key({ key: "g" });
    key({ key: "p" });
    expect(h.navigate).toHaveBeenCalledWith("/projects");
  });

  it("g then an unrelated key does not navigate (and the unrelated key is not prevented)", () => {
    mount();
    key({ key: "g" });
    const ev = new KeyboardEvent("keydown", { key: "x", cancelable: true });
    window.dispatchEvent(ev);
    expect(h.navigate).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("g then timeout disarms (later p does not navigate)", () => {
    mount();
    key({ key: "g" });
    vi.advanceTimersByTime(1100);
    key({ key: "p" });
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

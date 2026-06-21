import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

// jsdom lacks the pointer-capture + scroll APIs Radix menus call on open.
if (typeof Element !== "undefined") {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

// jsdom has no EventSource. Provide an inert default so any component that opens
// a stream (e.g. useBoardRealtime) does not throw. Tests asserting stream
// behaviour stub their own recording EventSource over this.
if (!("EventSource" in globalThis)) {
  class NoopEventSource {
    onopen: ((e: Event) => void) | null = null;
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    constructor(_url: string, _init?: unknown) {}
    close() {}
  }
  vi.stubGlobal("EventSource", NoopEventSource as unknown as typeof EventSource);
}

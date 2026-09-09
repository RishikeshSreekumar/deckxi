// @vitest-environment jsdom
/**
 * #129: typing inside a sheet must never lose focus. Landing re-renders on
 * every keystroke and passed a fresh `onClose` each time; the sheet used to
 * re-focus itself on that change, which closed the phone keyboard mid-word.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./Dialog.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Dialog", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (onClose: () => void) =>
    act(() => {
      root.render(
        <Dialog title="Test" onClose={onClose}>
          <input aria-label="name" />
        </Dialog>,
      );
    });

  it("focuses the sheet on open", () => {
    render(() => {});
    expect(document.activeElement?.getAttribute("role")).toBe("dialog");
  });

  it("keeps focus in the input when the parent re-renders with a new onClose", () => {
    render(() => {});
    const input = host.querySelector("input") as HTMLInputElement;
    act(() => input.focus());
    expect(document.activeElement).toBe(input);

    for (let i = 0; i < 5; i++) render(() => {}); // a fresh arrow every render
    expect(document.activeElement).toBe(input);
  });

  it("calls the latest onClose on Escape", () => {
    const first = vi.fn();
    const second = vi.fn();
    render(first);
    render(second);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

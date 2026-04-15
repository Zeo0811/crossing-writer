import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BriefIntakeForm } from "../BriefIntakeForm";

function mockFetchOk(items: any[]) {
  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ items }),
    text: async () => "",
  }));
}

describe("BriefIntakeForm rich-media", () => {
  beforeEach(() => {
    mockFetchOk([
      {
        kind: "image",
        url: "images/abc.png",
        filename: "p.png",
        size: 1234,
        mime: "image/png",
      },
    ]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the new image and file buttons + textarea", () => {
    render(<BriefIntakeForm projectId="p1" onUploaded={() => {}} />);
    expect(screen.getByTestId("brief-image-button")).toBeTruthy();
    expect(screen.getByTestId("brief-file-button")).toBeTruthy();
    expect(screen.getByTestId("brief-textarea")).toBeTruthy();
  });

  it("inserts markdown at caret on paste", async () => {
    render(<BriefIntakeForm projectId="p1" onUploaded={() => {}} />);
    const ta = screen.getByTestId("brief-textarea") as HTMLTextAreaElement;
    const user = userEvent.setup();
    await user.type(ta, "BEFORE/AFTER");
    ta.setSelectionRange(6, 6); // between BEFORE and /AFTER
    const file = new File([new Uint8Array([1])], "p.png", { type: "image/png" });
    const ev = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", {
      value: {
        items: [{ kind: "file", type: "image/png", getAsFile: () => file }],
        files: [file],
      },
    });
    await act(async () => {
      ta.dispatchEvent(ev);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ta.value).toMatch(/^BEFORE!\[p\.png\]\(\/api\/projects\/p1\/brief\/images\/abc\.png\)\/AFTER$/);
    // attachment list shown
    expect(screen.getByTestId("brief-attachment-list")).toBeTruthy();
  });

  it("uploads via image button file picker", async () => {
    render(<BriefIntakeForm projectId="p1" onUploaded={() => {}} />);
    const input = screen.getByTestId("brief-image-input") as HTMLInputElement;
    const file = new File([new Uint8Array([1])], "p.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
    const ta = screen.getByTestId("brief-textarea") as HTMLTextAreaElement;
    expect(ta.value).toMatch(/!\[p\.png\]/);
  });

  it("shows drop overlay while dragging", async () => {
    render(<BriefIntakeForm projectId="p1" onUploaded={() => {}} />);
    const ta = screen.getByTestId("brief-textarea");
    const ev = new Event("dragenter", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: { files: [] } });
    await act(async () => {
      ta.dispatchEvent(ev);
    });
    expect(screen.getByTestId("brief-drop-overlay")).toBeTruthy();
  });
});

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

  it("submits image-tab imageFiles as markdown text via uploadBriefText", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: (_: string) => "application/json" },
        json: async () => ({ items: [{ kind: "image", url: "images/a.png", filename: "a.png", size: 1, mime: "image/png" }] }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: (_: string) => "application/json" },
        json: async () => ({ items: [{ kind: "image", url: "images/b.png", filename: "b.png", size: 1, mime: "image/png" }] }),
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: (_: string) => "application/json" },
        json: async () => ({ ok: true }),
        text: async () => "",
      });
    (globalThis as any).fetch = fetchMock;

    const onUploaded = vi.fn();
    render(<BriefIntakeForm projectId="p1" onUploaded={onUploaded} />);

    // Switch to 图片 tab
    const imgTabBtn = screen.getByRole("button", { name: /图片/ });
    await userEvent.click(imgTabBtn);

    // Upload 2 images via hidden input (the image-tab input accepts image/*)
    const fileInput = document.querySelector('input[type="file"][accept="image/*"]') as HTMLInputElement;
    const f1 = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const f2 = new File([new Uint8Array([2])], "b.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [f1] } });
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [f2] } });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Click submit
    const submitBtn = screen.getByRole("button", { name: /提交并解析/ });
    await act(async () => {
      await userEvent.click(submitBtn);
    });

    // Last fetch call should be a brief text POST with markdown containing both image refs (using relative urls, not prefixed)
    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const [url, init] = lastCall;
    expect(String(url)).toMatch(/\/api\/projects\/p1\/brief$/);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.text).toContain("![a.png](images/a.png)");
    expect(body.text).toContain("![b.png](images/b.png)");
    expect(onUploaded).toHaveBeenCalled();
  });
});

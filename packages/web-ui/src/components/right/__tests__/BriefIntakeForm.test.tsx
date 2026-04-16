import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BriefIntakeForm } from "../BriefIntakeForm";

function mockFetchOk(items: any[]) {
  (globalThis as any).fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    headers: { get: (_: string) => "application/json" },
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

  it("renders article_type dropdown, tab buttons, and textarea", () => {
    render(<BriefIntakeForm projectId="p1" onUploaded={() => {}} />);
    // article_type dropdown
    expect(screen.getByRole("combobox")).toBeTruthy();
    // tab buttons
    expect(screen.getByRole("button", { name: /图片/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /文件/ })).toBeTruthy();
    expect(screen.getByTestId("brief-textarea")).toBeTruthy();
  });

  it("blocks submit when article_type not selected", async () => {
    render(<BriefIntakeForm projectId="p1" onUploaded={() => {}} />);
    const textarea = screen.getByTestId("brief-textarea") as HTMLElement;
    fireEvent.input(textarea, { target: { innerHTML: "some text" } });
    const submitBtn = screen.getByRole("button", { name: /提交并解析/ });
    await act(async () => {
      await userEvent.click(submitBtn);
    });
    // Should show error, not call fetch for brief upload
    expect(screen.getByText("请先选择文章类型")).toBeTruthy();
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

    // Select article_type first
    const select = screen.getByRole("combobox");
    await act(async () => {
      fireEvent.change(select, { target: { value: "实测" } });
    });

    // Switch to 图片 tab
    const imgTabBtn = screen.getByRole("button", { name: /图片/ });
    await userEvent.click(imgTabBtn);

    // Upload 2 images via the hidden image-tab input
    const fileInput = screen.getByTestId("brief-image-tab-input") as HTMLInputElement;
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
    expect(body.articleType).toBe("实测");
    expect(onUploaded).toHaveBeenCalled();
  });
});

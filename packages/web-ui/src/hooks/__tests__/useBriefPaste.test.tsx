import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useRef } from "react";
import { useBriefPaste } from "../useBriefPaste";

function Harness({
  onInsert,
  onError,
}: {
  onInsert: (md: string) => void;
  onError?: (e: Error) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useBriefPaste(ref, { projectId: "p1", onInsert, onError });
  return <textarea ref={ref} data-testid="ta" />;
}

function makePasteEvent(files: File[]): Event {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  const items = files.map((f) => ({
    kind: "file" as const,
    type: f.type,
    getAsFile: () => f,
  }));
  Object.defineProperty(ev, "clipboardData", {
    value: {
      items,
      files,
    },
  });
  return ev;
}

describe("useBriefPaste", () => {
  beforeEach(() => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            kind: "image",
            url: "images/abc.png",
            filename: "p.png",
            size: 100,
            mime: "image/png",
          },
        ],
      }),
      text: async () => "",
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads pasted image and inserts markdown", async () => {
    const onInsert = vi.fn();
    const r = render(<Harness onInsert={onInsert} />);
    const ta = r.getByTestId("ta");
    const file = new File([new Uint8Array([1, 2, 3])], "p.png", { type: "image/png" });
    await act(async () => {
      ta.dispatchEvent(makePasteEvent([file]));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert.mock.calls[0][0]).toMatch(/^!\[p\.png\]\(\/api\/projects\/p1\/brief\/images\/abc\.png\)$/);
  });

  it("ignores paste events with no files", async () => {
    const onInsert = vi.fn();
    const r = render(<Harness onInsert={onInsert} />);
    const ta = r.getByTestId("ta");
    await act(async () => {
      ta.dispatchEvent(makePasteEvent([]));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onInsert).not.toHaveBeenCalled();
    expect((globalThis as any).fetch).not.toHaveBeenCalled();
  });

  it("inserts file-style markdown for non-image files", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            kind: "file",
            url: "attachments/abc-doc.pdf",
            filename: "doc.pdf",
            size: 100,
            mime: "application/pdf",
          },
        ],
      }),
      text: async () => "",
    }));
    const onInsert = vi.fn();
    const r = render(<Harness onInsert={onInsert} />);
    const ta = r.getByTestId("ta");
    const file = new File([new Uint8Array([1, 2, 3])], "doc.pdf", {
      type: "application/pdf",
    });
    await act(async () => {
      ta.dispatchEvent(makePasteEvent([file]));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onInsert.mock.calls[0][0]).toMatch(
      /^\[📎 doc\.pdf\]\(\/api\/projects\/p1\/brief\/files\/abc-doc\.pdf\)$/,
    );
  });

  it("calls onError when upload fails", async () => {
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: "bad" }),
      text: async () => "bad",
    }));
    const onInsert = vi.fn();
    const onError = vi.fn();
    const r = render(<Harness onInsert={onInsert} onError={onError} />);
    const ta = r.getByTestId("ta");
    const file = new File([new Uint8Array([1])], "x.png", { type: "image/png" });
    await act(async () => {
      ta.dispatchEvent(makePasteEvent([file]));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onInsert).not.toHaveBeenCalled();
  });
});

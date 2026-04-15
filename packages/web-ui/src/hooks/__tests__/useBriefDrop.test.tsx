import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useRef } from "react";
import { useBriefDrop } from "../useBriefDrop";

function Harness({ onInsert }: { onInsert: (md: string) => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const r = useBriefDrop(ref, { projectId: "p1", onInsert });
  return (
    <div ref={ref} data-testid="zone" data-dragging={r.isDragging ? "1" : "0"}>
      drop here
    </div>
  );
}

function makeDragEvent(type: string, files: File[]): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", {
    value: { files, items: files.map((f) => ({ kind: "file", type: f.type })) },
  });
  return ev;
}

describe("useBriefDrop", () => {
  beforeEach(() => {
    let i = 0;
    (globalThis as any).fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            kind: "image",
            url: `images/h${i++}.png`,
            filename: `f${i}.png`,
            size: 10,
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

  it("toggles isDragging on dragenter/dragleave", async () => {
    const onInsert = vi.fn();
    const r = render(<Harness onInsert={onInsert} />);
    const zone = r.getByTestId("zone");
    await act(async () => {
      zone.dispatchEvent(makeDragEvent("dragenter", []));
    });
    expect(zone.getAttribute("data-dragging")).toBe("1");
    await act(async () => {
      zone.dispatchEvent(makeDragEvent("dragleave", []));
    });
    expect(zone.getAttribute("data-dragging")).toBe("0");
  });

  it("uploads multiple dropped files and inserts markdown for each", async () => {
    const onInsert = vi.fn();
    const r = render(<Harness onInsert={onInsert} />);
    const zone = r.getByTestId("zone");
    const files = [
      new File([new Uint8Array([1])], "a.png", { type: "image/png" }),
      new File([new Uint8Array([2])], "b.png", { type: "image/png" }),
    ];
    await act(async () => {
      zone.dispatchEvent(makeDragEvent("drop", files));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect((globalThis as any).fetch).toHaveBeenCalledTimes(2);
    expect(onInsert).toHaveBeenCalledTimes(2);
    expect(onInsert.mock.calls[0][0]).toMatch(/^!\[/);
  });

  it("ignores empty drop", async () => {
    const onInsert = vi.fn();
    const r = render(<Harness onInsert={onInsert} />);
    const zone = r.getByTestId("zone");
    await act(async () => {
      zone.dispatchEvent(makeDragEvent("drop", []));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("continues after one upload fails (partial-failure)", async () => {
    let n = 0;
    (globalThis as any).fetch = vi.fn(async () => {
      n += 1;
      if (n === 1) {
        return {
          ok: false,
          status: 400,
          json: async () => ({}),
          text: async () => "bad",
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          items: [
            {
              kind: "image",
              url: "images/ok.png",
              filename: "ok.png",
              size: 1,
              mime: "image/png",
            },
          ],
        }),
        text: async () => "",
      };
    });
    const onInsert = vi.fn();
    const r = render(<Harness onInsert={onInsert} />);
    const zone = r.getByTestId("zone");
    const files = [
      new File([new Uint8Array([1])], "bad.png", { type: "image/png" }),
      new File([new Uint8Array([2])], "ok.png", { type: "image/png" }),
    ];
    await act(async () => {
      zone.dispatchEvent(makeDragEvent("drop", files));
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(onInsert).toHaveBeenCalledTimes(1);
  });
});

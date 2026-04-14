import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act, waitFor } from "@testing-library/react";
import { useRef } from "react";

vi.mock("../../src/api/writer-client", () => ({
  uploadImage: vi.fn(),
}));

import * as client from "../../src/api/writer-client";
import { useImageDrop } from "../../src/hooks/useImageDrop";

const uploadImageMock = client.uploadImage as unknown as ReturnType<typeof vi.fn>;

function Harness({ onInsert, onError }: { onInsert: (m: string) => void; onError?: (e: Error) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { isDragging, uploading, uploadTotal, uploadDone } = useImageDrop(ref, {
    projectId: "p1",
    onInsert,
    onError,
  });
  return (
    <div ref={ref} data-testid="drop" data-dragging={String(isDragging)} data-uploading={String(uploading)} data-total={uploadTotal} data-done={uploadDone}>
      drop-zone
    </div>
  );
}

function dataTransfer(files: File[]): any {
  return {
    files,
    items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
    types: ["Files"],
  };
}

describe("useImageDrop", () => {
  beforeEach(() => uploadImageMock.mockReset());

  it("dragover sets isDragging; dragleave clears it", async () => {
    const { getByTestId } = render(<Harness onInsert={vi.fn()} />);
    const el = getByTestId("drop");
    fireEvent.dragEnter(el, { dataTransfer: dataTransfer([]) });
    expect(el.dataset.dragging).toBe("true");
    fireEvent.dragLeave(el, { dataTransfer: dataTransfer([]) });
    expect(el.dataset.dragging).toBe("false");
  });

  it("drop of image/png file triggers upload and onInsert", async () => {
    uploadImageMock.mockResolvedValue({
      url: "/api/projects/p1/images/abc.png",
      filename: "abc.png",
      bytes: 3,
      mime: "image/png",
    });
    const onInsert = vi.fn();
    const { getByTestId } = render(<Harness onInsert={onInsert} />);
    const file = new File([new Uint8Array([1, 2])], "a.png", { type: "image/png" });
    await act(async () => {
      fireEvent.drop(getByTestId("drop"), { dataTransfer: dataTransfer([file]) });
      await Promise.resolve();
    });
    await waitFor(() => expect(uploadImageMock).toHaveBeenCalledWith("p1", file));
    await waitFor(() => expect(onInsert).toHaveBeenCalledWith("![a.png](/api/projects/p1/images/abc.png)\n"));
  });

  it("drop of two files yields two onInsert calls in order", async () => {
    uploadImageMock
      .mockResolvedValueOnce({ url: "/u/1.png", filename: "1.png", bytes: 1, mime: "image/png" })
      .mockResolvedValueOnce({ url: "/u/2.png", filename: "2.png", bytes: 1, mime: "image/png" });
    const onInsert = vi.fn();
    const { getByTestId } = render(<Harness onInsert={onInsert} />);
    const f1 = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const f2 = new File([new Uint8Array([2])], "b.png", { type: "image/png" });
    await act(async () => {
      fireEvent.drop(getByTestId("drop"), { dataTransfer: dataTransfer([f1, f2]) });
      await Promise.resolve();
    });
    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(2));
    expect(onInsert.mock.calls[0]![0]).toContain("/u/1.png");
    expect(onInsert.mock.calls[1]![0]).toContain("/u/2.png");
  });

  it("drop of non-image file is ignored", async () => {
    const onInsert = vi.fn();
    const { getByTestId } = render(<Harness onInsert={onInsert} />);
    const file = new File([new Uint8Array([1])], "a.txt", { type: "text/plain" });
    await act(async () => {
      fireEvent.drop(getByTestId("drop"), { dataTransfer: dataTransfer([file]) });
      await Promise.resolve();
    });
    expect(uploadImageMock).not.toHaveBeenCalled();
    expect(onInsert).not.toHaveBeenCalled();
  });
});

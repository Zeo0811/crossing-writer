import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({
  uploadImage: vi.fn(),
}));

import * as client from "../../../src/api/writer-client";
import { ImageUploadButton } from "../../../src/components/writer/ImageUploadButton";

const uploadImageMock = client.uploadImage as unknown as ReturnType<typeof vi.fn>;

describe("ImageUploadButton", () => {
  beforeEach(() => uploadImageMock.mockReset());

  it("renders the button", () => {
    render(<ImageUploadButton projectId="p1" onInsert={vi.fn()} />);
    expect(screen.getByText(/插图/)).toBeTruthy();
  });

  it("clicking button triggers hidden input click", () => {
    render(<ImageUploadButton projectId="p1" onInsert={vi.fn()} />);
    const input = screen.getByTestId("image-upload-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");
    fireEvent.click(screen.getByText(/插图/));
    expect(clickSpy).toHaveBeenCalled();
  });

  it("file selection calls uploadImage and onInsert with markdown", async () => {
    uploadImageMock.mockResolvedValue({
      url: "/api/projects/p1/images/abc.png",
      filename: "abc.png",
      bytes: 3,
      mime: "image/png",
    });
    const onInsert = vi.fn();
    render(<ImageUploadButton projectId="p1" onInsert={onInsert} />);
    const file = new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" });
    const input = screen.getByTestId("image-upload-input") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(uploadImageMock).toHaveBeenCalled());
    expect(uploadImageMock.mock.calls[0]![0]).toBe("p1");
    expect(uploadImageMock.mock.calls[0]![1]).toBe(file);
    await waitFor(() => expect(onInsert).toHaveBeenCalledWith("![a.png](/api/projects/p1/images/abc.png)"));
  });

  it("respects disabled prop (no click fires input)", () => {
    render(<ImageUploadButton projectId="p1" onInsert={vi.fn()} disabled />);
    const btn = screen.getByText(/插图/) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});

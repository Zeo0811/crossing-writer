import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FileUploader } from "../../src/components/evidence/FileUploader";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

function wrap(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("FileUploader", () => {
  it("renders dropzone label + accept hint", () => {
    wrap(<FileUploader
      label="测试上传"
      accept="image/*"
      hint="只接受图片"
      files={[]}
      onUpload={async () => {}}
      onDelete={async () => {}}
    />);
    expect(screen.getByText("测试上传 (0)")).toBeInTheDocument();
    expect(screen.getByText(/只接受图片/)).toBeInTheDocument();
  });

  it("renders existing files list", () => {
    wrap(<FileUploader
      label="x"
      accept="image/*"
      hint=""
      files={[
        { filename: "a.png", relPath: "a", size: 1024, uploaded_at: "" },
        { filename: "b.png", relPath: "b", size: 2048, uploaded_at: "" },
      ]}
      onUpload={async () => {}}
      onDelete={async () => {}}
    />);
    expect(screen.getByText("a.png")).toBeInTheDocument();
    expect(screen.getByText("b.png")).toBeInTheDocument();
  });

  it("calls onDelete with filename", async () => {
    const onDelete = vi.fn(async () => {});
    wrap(<FileUploader
      label="x"
      accept="image/*"
      hint=""
      files={[{ filename: "a.png", relPath: "a", size: 100, uploaded_at: "" }]}
      onUpload={async () => {}}
      onDelete={onDelete}
    />);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByLabelText("delete a.png"));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("a.png"));
  });
});

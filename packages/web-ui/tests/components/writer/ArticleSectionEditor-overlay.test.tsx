import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({
  uploadImage: vi.fn(),
}));

import { ArticleSectionEditor } from "../../../src/components/writer/ArticleSectionEditor";

describe("ArticleSectionEditor drop overlay (SP-13 T9)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("overlay with '拖到这里上传' appears on dragover, disappears on dragleave", () => {
    render(
      <ArticleSectionEditor
        initialBody=""
        projectId="p1"
        sectionKey="opening"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const container = screen.getByTestId("section-editor-container");
    expect(screen.queryByTestId("drop-overlay")).toBeNull();
    fireEvent.dragEnter(container);
    expect(screen.getByTestId("drop-overlay").textContent).toMatch(/拖到这里上传/);
    fireEvent.dragLeave(container);
    expect(screen.queryByTestId("drop-overlay")).toBeNull();
  });
});

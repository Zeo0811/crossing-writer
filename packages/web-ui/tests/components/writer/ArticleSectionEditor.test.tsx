import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({
  uploadImage: vi.fn(async () => ({
    url: "/api/projects/p1/images/abc.png",
    filename: "abc.png",
    bytes: 3,
    mime: "image/png",
  })),
}));

import { ArticleSectionEditor } from "../../../src/components/writer/ArticleSectionEditor";

describe("ArticleSectionEditor", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders textarea with initialBody", () => {
    render(
      <ArticleSectionEditor
        initialBody="hello"
        projectId="p1"
        sectionKey="opening"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("hello");
  });

  it("typing updates the controlled value", () => {
    render(
      <ArticleSectionEditor
        initialBody="a"
        projectId="p1"
        sectionKey="opening"
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "ab" } });
    expect(ta.value).toBe("ab");
  });

  it("clicking 保存 calls onSave with current textarea value", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <ArticleSectionEditor
        initialBody="first"
        projectId="p1"
        sectionKey="opening"
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "second" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("second"));
  });

  it("clicking 取消 calls onCancel and not onSave", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    render(
      <ArticleSectionEditor
        initialBody="x"
        projectId="p1"
        sectionKey="opening"
        onSave={onSave}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText("取消"));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("disabled prop disables textarea and save button", () => {
    render(
      <ArticleSectionEditor
        initialBody="x"
        projectId="p1"
        sectionKey="opening"
        onSave={vi.fn()}
        onCancel={vi.fn()}
        disabled
      />,
    );
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByText("保存") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows 保存中... while save is pending", async () => {
    let resolveIt: () => void = () => {};
    const onSave = vi.fn(() => new Promise<void>((r) => { resolveIt = r; }));
    render(
      <ArticleSectionEditor
        initialBody="x"
        projectId="p1"
        sectionKey="opening"
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(screen.getByText("保存中...")).toBeTruthy());
    await act(async () => { resolveIt(); });
  });
});

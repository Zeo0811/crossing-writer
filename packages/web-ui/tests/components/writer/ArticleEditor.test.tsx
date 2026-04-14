import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({
  getFinal: vi.fn(async () => "---\ntype: article_draft\n---\n<!-- section:opening -->\nOPEN\n\n<!-- section:closing -->\nCLOSE"),
  putSection: vi.fn(async () => {}),
  rewriteSectionStream: vi.fn(async (_p, _k, _h, onEv) => {
    onEv({ type: "writer.rewrite_chunk", data: { section_key: "opening", chunk: "OPEN_NEW" } });
    onEv({ type: "writer.rewrite_completed", data: { section_key: "opening", last_agent: "writer.opening" } });
  }),
}));

import { ArticleEditor } from "../../../src/components/writer/ArticleEditor";
import { rewriteSectionStream, putSection } from "../../../src/api/writer-client";

describe("ArticleEditor", () => {
  beforeEach(() => {
    (rewriteSectionStream as any).mockClear();
    (putSection as any).mockClear();
  });

  it("loads final.md and renders textarea with content", async () => {
    render(<ArticleEditor projectId="pid" />);
    await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("OPEN"));
  });

  it("sectionKeyForSelection returns opening when selection inside opening marker", async () => {
    render(<ArticleEditor projectId="pid" />);
    await waitFor(() => screen.getByRole("textbox"));
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    const val = ta.value;
    const openIdx = val.indexOf("OPEN");
    ta.focus();
    ta.setSelectionRange(openIdx, openIdx + 4);
    fireEvent.select(ta);
    const btn = await screen.findByRole("button", { name: /@agent 重写/ });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it("rewrite toolbar disabled when selection crosses sections", async () => {
    render(<ArticleEditor projectId="pid" />);
    await waitFor(() => screen.getByRole("textbox"));
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
    fireEvent.select(ta);
    const btn = await screen.findByRole("button", { name: /@agent 重写/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("clicking rewrite → streams chunk → replaces in-section content", async () => {
    render(<ArticleEditor projectId="pid" />);
    await waitFor(() => screen.getByRole("textbox"));
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    const openIdx = ta.value.indexOf("OPEN");
    ta.focus();
    ta.setSelectionRange(openIdx, openIdx + 4);
    fireEvent.select(ta);
    const btn = await screen.findByRole("button", { name: /@agent 重写/ });
    fireEvent.click(btn);
    const confirm = await screen.findByRole("button", { name: /^确认$/ });
    fireEvent.click(confirm);
    await waitFor(() => expect(ta.value).toContain("OPEN_NEW"));
  });

  it("debounced auto-save calls putSection 3s after edit", async () => {
    vi.useFakeTimers();
    render(<ArticleEditor projectId="pid" />);
    await vi.runAllTimersAsync();
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: ta.value.replace("OPEN", "OPEN EDIT") } });
    await act(async () => { vi.advanceTimersByTime(3100); });
    expect((putSection as any).mock.calls.length).toBeGreaterThanOrEqual(1);
    vi.useRealTimers();
  });
});

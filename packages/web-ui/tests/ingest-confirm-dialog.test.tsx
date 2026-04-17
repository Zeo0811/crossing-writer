import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { IngestConfirmDialog } from "../src/components/wiki/IngestConfirmDialog";
import type { CartEntry } from "../src/hooks/useIngestCart";

const entries: CartEntry[] = [
  { articleId: "A0", account: "AcctA", title: "T0", publishedAt: "2026-04-15", wordCount: 100 },
  { articleId: "A1", account: "AcctA", title: "T1", publishedAt: "2026-04-14", wordCount: 200 },
];

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

function mockDupResponse(alreadyIngestedIds: string[], fresh: string[]) {
  vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify({
      already_ingested: alreadyIngestedIds.map((id) => ({ article_id: id, first_ingested_at: "2026-04-01", last_ingested_at: "2026-04-02", last_run_id: "r1" })),
      fresh,
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
}

describe("IngestConfirmDialog", () => {
  it("renders summary with fresh count when no duplicates", async () => {
    mockDupResponse([], ["A0", "A1"]);
    render(<IngestConfirmDialog open entries={entries} model={{ cli: "claude", model: "sonnet" }} onConfirm={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText(/2 篇/)).toBeInTheDocument());
    expect(screen.queryByText(/已入过库/)).toBeNull();
  });

  it("shows already-ingested warning with count", async () => {
    mockDupResponse(["A0"], ["A1"]);
    render(<IngestConfirmDialog open entries={entries} model={{ cli: "claude", model: "sonnet" }} onConfirm={() => {}} onCancel={() => {}} />);
    await waitFor(() => expect(screen.getByText(/1 篇.*已入/)).toBeInTheDocument());
    const checkbox = screen.getByRole("checkbox", { name: /重新入库/ }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("confirm with force_reingest=true passes flag + includes all ids", async () => {
    mockDupResponse(["A0"], ["A1"]);
    const onConfirm = vi.fn();
    render(<IngestConfirmDialog open entries={entries} model={{ cli: "claude", model: "sonnet" }} onConfirm={onConfirm} onCancel={() => {}} />);
    await waitFor(() => screen.getByText(/1 篇.*已入/));
    fireEvent.click(screen.getByRole("checkbox", { name: /重新入库/ }));
    fireEvent.click(screen.getByRole("button", { name: /确认入库/ }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      mode: "selected",
      article_ids: expect.arrayContaining(["A0", "A1"]),
      force_reingest: true,
      cli_model: { cli: "claude", model: "sonnet" },
    }));
  });

  it("confirm without force_reingest omits duplicates from article_ids", async () => {
    mockDupResponse(["A0"], ["A1"]);
    const onConfirm = vi.fn();
    render(<IngestConfirmDialog open entries={entries} model={{ cli: "claude", model: "sonnet" }} onConfirm={onConfirm} onCancel={() => {}} />);
    await waitFor(() => screen.getByText(/1 篇.*已入/));
    fireEvent.click(screen.getByRole("button", { name: /确认入库/ }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      article_ids: ["A1"],
      force_reingest: false,
    }));
  });

  it("cancel fires onCancel", async () => {
    mockDupResponse([], ["A0", "A1"]);
    const onCancel = vi.fn();
    render(<IngestConfirmDialog open entries={entries} model={{ cli: "claude", model: "sonnet" }} onConfirm={() => {}} onCancel={onCancel} />);
    await waitFor(() => screen.getByText(/2 篇/));
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onCancel).toHaveBeenCalled();
  });
});

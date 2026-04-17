import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AccountHeatmap } from "../src/components/wiki/AccountHeatmap";

beforeEach(() => { vi.restoreAllMocks(); });

function mockArticles(articles: Array<{ id: string; title: string; published_at: string; ingest_status: string; word_count: number | null }>) {
  vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify(articles), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
}

describe("AccountHeatmap (refactored)", () => {
  it("does not render internal ingest-submit UI", async () => {
    mockArticles([{ id: "A0", title: "t", published_at: "2026-04-15", ingest_status: "raw", word_count: 100 }]);
    render(<AccountHeatmap account="AcctA" />);
    await waitFor(() => expect(screen.queryByText(/加载/)).toBeNull());
    expect(screen.queryByText(/入库选中/)).toBeNull();
    expect(screen.queryByText(/全选未入库/)).toBeNull();
    expect(screen.queryByText(/清空选择/)).toBeNull();
    expect(screen.queryByText(/已选 \d+/)).toBeNull();
  });

  it("renders legend (未入库/部分入库/全部入库)", async () => {
    mockArticles([{ id: "A0", title: "t", published_at: "2026-04-15", ingest_status: "raw", word_count: 100 }]);
    render(<AccountHeatmap account="AcctA" />);
    await waitFor(() => expect(screen.getByText(/未入库/)).toBeInTheDocument());
    expect(screen.getByText(/全部入库/)).toBeInTheDocument();
  });

  it("shows 'no articles' message when empty", async () => {
    mockArticles([]);
    render(<AccountHeatmap account="AcctA" />);
    await waitFor(() => expect(screen.getByText(/无文章|该账号无文章/)).toBeInTheDocument());
  });
});

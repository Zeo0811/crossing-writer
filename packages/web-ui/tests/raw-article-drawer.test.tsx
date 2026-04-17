import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { RawArticleDrawer } from "../src/components/wiki/RawArticleDrawer";

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("RawArticleDrawer", () => {
  it("fetches and renders raw article when open", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        id: "abc", account: "acc", title: "Hello", author: "Me",
        published_at: "2026-04-15", url: "https://x.com/a",
        body_plain: "正文第一段。\n正文第二段。", md_path: null, word_count: 20,
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    render(<RawArticleDrawer open={true} account="acc" articleId="abc" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("Hello")).toBeInTheDocument());
    expect(screen.getByText(/正文第一段/)).toBeInTheDocument();
    expect(screen.getByText("acc")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /原 URL/ });
    expect(link).toHaveAttribute("href", "https://x.com/a");
  });

  it("shows cleared placeholder on 404", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("not found", { status: 404 }));
    render(<RawArticleDrawer open={true} account="acc" articleId="nope" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/原文档案已清理/)).toBeInTheDocument());
  });

  it("calls onClose when close clicked", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "abc", account: "acc", title: "t", author: null, published_at: "2026-04-15", url: null, body_plain: "", md_path: null, word_count: null }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const onClose = vi.fn();
    render(<RawArticleDrawer open={true} account="acc" articleId="abc" onClose={onClose} />);
    await waitFor(() => screen.getByText("t"));
    fireEvent.click(screen.getByRole("button", { name: /关闭/ }));
    expect(onClose).toHaveBeenCalled();
  });
});

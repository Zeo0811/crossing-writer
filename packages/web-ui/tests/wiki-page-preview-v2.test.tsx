import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { WikiPagePreview } from "../src/components/wiki/WikiPagePreview";
import { __resetWikiIndexCache } from "../src/hooks/useWikiIndex";

beforeEach(() => {
  __resetWikiIndexCache();
  vi.restoreAllMocks();
});
afterEach(() => { vi.restoreAllMocks(); });

function mockResponses(handlers: Record<string, Response>) {
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    for (const k of Object.keys(handlers)) {
      if (url.includes(k)) return handlers[k]!.clone();
    }
    return new Response("not mocked: " + url, { status: 500 });
  });
}

describe("WikiPagePreview v2", () => {
  it("fetches meta + renders body and frontmatter footer", async () => {
    mockResponses({
      "/api/kb/wiki/pages/entities/阶跃星辰.md?meta=1": new Response(JSON.stringify({
        frontmatter: {
          type: "entity", title: "阶跃星辰",
          sources: [{ account: "acc", article_id: "abc12345xx", quoted: "quote" }],
          backlinks: ["entities/StepClaw.md"],
        },
        body: "StepClaw 是阶跃星辰的产品",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      "/api/kb/wiki/index.json": new Response(JSON.stringify([
        { path: "entities/阶跃星辰.md", title: "阶跃星辰", aliases: ["StepFun"] },
        { path: "entities/StepClaw.md", title: "StepClaw", aliases: [] },
      ]), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    const onNavigate = vi.fn();
    render(<WikiPagePreview path="entities/阶跃星辰.md" onNavigate={onNavigate} onOpenSource={() => {}} />);
    await waitFor(() => expect(screen.getByText("quote", { exact: false })).toBeInTheDocument());
    // body auto-link: StepClaw should become clickable
    const link = await screen.findByRole("button", { name: "StepClaw" });
    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith("entities/StepClaw.md");
  });

  it("does not self-link page title in its own body", async () => {
    mockResponses({
      "/api/kb/wiki/pages/entities/A.md?meta=1": new Response(JSON.stringify({
        frontmatter: { type: "entity", title: "阶跃星辰" },
        body: "阶跃星辰 的正文",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      "/api/kb/wiki/index.json": new Response(JSON.stringify([
        { path: "entities/A.md", title: "阶跃星辰", aliases: [] },
      ]), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    render(<WikiPagePreview path="entities/A.md" onNavigate={() => {}} onOpenSource={() => {}} />);
    await waitFor(() => expect(screen.getByText(/阶跃星辰 的正文/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "阶跃星辰" })).toBeNull();
  });

  it("calls onOpenSource when source clicked", async () => {
    mockResponses({
      "/api/kb/wiki/pages/x.md?meta=1": new Response(JSON.stringify({
        frontmatter: { type: "entity", title: "x", sources: [{ account: "acc", article_id: "zzzzzzzzzz", quoted: "q" }] },
        body: "",
      }), { status: 200, headers: { "Content-Type": "application/json" } }),
      "/api/kb/wiki/index.json": new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    const onOpenSource = vi.fn();
    render(<WikiPagePreview path="x.md" onNavigate={() => {}} onOpenSource={onOpenSource} />);
    await waitFor(() => screen.getByText("acc"));
    fireEvent.click(screen.getByRole("button", { name: /acc.*zzzzzzzz/ }));
    expect(onOpenSource).toHaveBeenCalledWith("acc", "zzzzzzzzzz");
  });

  it("renders fallback when path is null", () => {
    render(<WikiPagePreview path={null} onNavigate={() => {}} onOpenSource={() => {}} />);
    expect(screen.getByText(/Select a page/i)).toBeInTheDocument();
  });
});

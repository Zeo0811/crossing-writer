import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { IngestTab } from "../src/components/wiki/IngestTab";
import { IngestProvider } from "../src/hooks/useIngestState";

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

function mockFetches(handlers: Record<string, Response>) {
  vi.spyOn(global, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    for (const k of Object.keys(handlers)) if (url.includes(k)) return handlers[k]!.clone();
    return new Response("not mocked", { status: 500 });
  });
}

describe("IngestTab smoke", () => {
  it("renders sidebar + main empty state + cart bar", async () => {
    mockFetches({
      "/api/kb/accounts": new Response(JSON.stringify([
        { account: "AcctA", count: 3, ingested_count: 0, earliest_published_at: "2026-04-10", latest_published_at: "2026-04-15" },
      ]), { status: 200, headers: { "Content-Type": "application/json" } }),
    });
    render(
      <IngestProvider>
        <IngestTab model={{ cli: "claude", model: "sonnet" }} />
      </IngestProvider>,
    );
    await waitFor(() => expect(screen.getByText("AcctA")).toBeInTheDocument());
    expect(screen.getByText(/账号（1）/)).toBeInTheDocument();
    expect(screen.getByText(/已选 0 篇/)).toBeInTheDocument();
    // Before any account is selected
    expect(screen.getByText(/选一个账号/)).toBeInTheDocument();
  });
});

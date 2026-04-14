import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { KnowledgePage } from "../src/pages/KnowledgePage";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.startsWith("/api/kb/wiki/pages")) {
      return Promise.resolve({ ok: true, json: async () => [{ path: "entities/A.md", kind: "entity", title: "A", aliases: [], sources_count: 1, backlinks_count: 0 }] });
    }
    if (url.startsWith("/api/kb/wiki/status")) {
      return Promise.resolve({ ok: true, json: async () => ({ total: 1, by_kind: { entity: 1 }, last_ingest_at: null }) });
    }
    if (url.startsWith("/api/kb/accounts")) {
      return Promise.resolve({ ok: true, json: async () => [{ account: "acc1", count: 5, earliest_published_at: "2025-01-01", latest_published_at: "2026-01-01" }] });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }));
});

describe("KnowledgePage", () => {
  it("renders Browse tab by default with WikiTree", async () => {
    render(<MemoryRouter><KnowledgePage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/entity \(1\)/)).toBeInTheDocument());
  });

  it("switches to Ingest tab", async () => {
    render(<MemoryRouter><KnowledgePage /></MemoryRouter>);
    fireEvent.click(screen.getByRole("tab", { name: /ingest/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument());
  });
});

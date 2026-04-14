import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({
  getSections: vi.fn(async () => ({ sections: [
    { key: "opening", frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "2026-04-14T12:00:00Z" }, preview: "p" },
    { key: "practice.case-01", frontmatter: { section: "practice.case-01", last_agent: "human", last_updated_at: "t" }, preview: "q" },
    { key: "closing", frontmatter: { section: "closing", last_agent: "writer.closing", last_updated_at: "t" }, preview: "r" },
  ]})),
}));
vi.mock("../../../src/hooks/useProjectStream", () => ({ useProjectStream: () => ({ events: [] }) }));

import { ArticleSection } from "../../../src/components/writer/ArticleSection";

describe("ArticleSection left panel", () => {
  it("evidence_ready shows waiting hint", () => {
    render(<ArticleSection projectId="pid" status="evidence_ready" />);
    expect(screen.getByText(/在右栏配置/)).toBeTruthy();
  });

  it("writing_ready shows section tree with opening / practice / closing", async () => {
    render(<ArticleSection projectId="pid" status="writing_ready" />);
    expect(await screen.findByText(/开头/)).toBeTruthy();
    expect(await screen.findByText(/case-01/)).toBeTruthy();
    expect(await screen.findByText(/结尾/)).toBeTruthy();
    expect(screen.getByText(/human/)).toBeTruthy();
  });
});

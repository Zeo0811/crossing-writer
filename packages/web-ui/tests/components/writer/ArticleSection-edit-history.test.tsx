import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const history = [
  { at: "2026-04-14T10:00:00Z", kind: "manual" },
  { at: "2026-04-14T11:00:00Z", kind: "manual" },
  { at: "2026-04-14T12:00:00Z", kind: "manual" },
];

vi.mock("../../../src/api/writer-client", () => ({
  getSections: vi.fn(async () => ({ sections: [
    {
      key: "opening",
      frontmatter: {
        section: "opening",
        last_agent: "human",
        last_updated_at: "2026-04-14T12:00:00Z",
        edit_history: history,
      },
      preview: "p",
    },
  ]})),
  getFinal: vi.fn(async () => "---\n---\n<!-- section:opening -->\nbody"),
  getAgentConfigs: vi.fn(async () => ({ agents: {} })),
  getProjectOverride: vi.fn(async () => ({ agents: {} })),
  listConfigStylePanels: vi.fn(async () => ({ panels: [] })),
  rewriteSectionStream: vi.fn(),
  putSection: vi.fn(async () => {}),
  uploadImage: vi.fn(),
}));
vi.mock("../../../src/hooks/useProjectStream", () => ({ useProjectStream: () => ({ events: [] }) }));

import { ArticleSection } from "../../../src/components/writer/ArticleSection";

describe("ArticleSection edit history expander (SP-13 T12)", () => {
  it("renders summary with count and most-recent timestamp when history non-empty", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    const expander = await screen.findByTestId("edit-history-expander");
    expect(expander).toBeTruthy();
    const summary = expander.querySelector("summary");
    expect(summary?.textContent).toMatch(/人工编辑 3 次/);
    expect(summary?.textContent).toContain("2026-04-14T12:00:00Z");
  });
});

describe("ArticleSection edit history expander hidden when empty", () => {
  it("does not render expander when edit_history is missing", async () => {
    vi.resetModules();
    vi.doMock("../../../src/api/writer-client", () => ({
      getSections: vi.fn(async () => ({ sections: [
        { key: "opening", frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "t" }, preview: "p" },
      ]})),
      getFinal: vi.fn(async () => "---\n---\n<!-- section:opening -->\nbody"),
      getAgentConfigs: vi.fn(async () => ({ agents: {} })),
      getProjectOverride: vi.fn(async () => ({ agents: {} })),
      listConfigStylePanels: vi.fn(async () => ({ panels: [] })),
      rewriteSectionStream: vi.fn(),
      putSection: vi.fn(async () => {}),
      uploadImage: vi.fn(),
    }));
    const mod = await import("../../../src/components/writer/ArticleSection");
    const { ArticleSection: AS } = mod;
    const { container } = render(<AS projectId="p1" status="writing_ready" />);
    await screen.findByText(/结尾|body|hello/i).catch(() => {});
    // The expander should not exist
    expect(container.querySelector('[data-testid="edit-history-expander"]')).toBeNull();
  });
});

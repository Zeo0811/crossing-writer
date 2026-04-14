import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("../../../src/api/writer-client", () => ({
  getSections: vi.fn(async () => ({ sections: [
    { key: "opening", frontmatter: { section: "opening", last_agent: "writer.opening", last_updated_at: "t" }, preview: "p" },
  ]})),
  getFinal: vi.fn(async () => "---\n---\n<!-- section:opening -->\nbody"),
  getAgentConfigs: vi.fn(async () => ({ agents: {} })),
  getProjectOverride: vi.fn(async () => ({ agents: {} })),
  listConfigStylePanels: vi.fn(async () => ({ panels: [] })),
  rewriteSectionStream: vi.fn(() => new Promise(() => {})), // never resolves
  putSection: vi.fn(async () => {}),
  uploadImage: vi.fn(),
}));
vi.mock("../../../src/hooks/useProjectStream", () => ({ useProjectStream: () => ({ events: [] }) }));

import { ArticleSection } from "../../../src/components/writer/ArticleSection";

describe("ArticleSection concurrency guard (SP-13 T10)", () => {
  it("edit button has tooltip and is disabled while rewrite is busy on the same section", async () => {
    const { container } = render(<ArticleSection projectId="p1" status="writing_ready" />);
    const toggle = await screen.findByTestId("edit-toggle-opening");
    // initially enabled
    expect((toggle as HTMLButtonElement).disabled).toBe(false);

    // Trigger rewrite: hover shows "🤖 重写整段", click opens input, confirm
    const rewriteOpen = await waitFor(() => {
      const btn = Array.from(container.querySelectorAll("button"))
        .find((b) => /重写整段/.test(b.textContent ?? ""));
      if (!btn) throw new Error("not found");
      return btn as HTMLButtonElement;
    });
    await act(async () => { fireEvent.click(rewriteOpen); });
    const confirm = Array.from(container.querySelectorAll("button"))
      .find((b) => /确认改整段/.test(b.textContent ?? "")) as HTMLButtonElement;
    await act(async () => { fireEvent.click(confirm); });

    // Now edit toggle should be disabled + carry tooltip
    await waitFor(() => {
      expect((toggle as HTMLButtonElement).disabled).toBe(true);
      expect(toggle.getAttribute("title")).toMatch(/写作中/);
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useProjectStream", () => ({
  useProjectStream: () => ({ events: [], activeAgents: [] }),
}));

vi.mock("../../../hooks/useWriterSections", () => ({
  useWriterSections: () => ({
    sections: [
      {
        key: "opening",
        preview: "",
        frontmatter: {
          section: "opening",
          last_agent: "writer.opening",
          last_updated_at: "",
          tools_used: [],
        },
      },
      {
        key: "closing",
        preview: "",
        frontmatter: {
          section: "closing",
          last_agent: "writer.closing",
          last_updated_at: "",
          tools_used: [],
        },
      },
    ],
  }),
}));

vi.mock("../../../hooks/useTextSelection", () => ({
  useTextSelection: () => ({ isActive: false, text: "", rect: null }),
}));

vi.mock("../../../api/writer-client", () => ({
  getFinal: vi.fn(async () => "<!-- section:opening -->body o\n\n<!-- section:closing -->body c"),
  rewriteSectionStream: vi.fn(),
  getAgentConfigs: vi.fn(),
  getProjectOverride: vi.fn(),
  listConfigStylePanels: vi.fn(),
}));

import { ArticleSection } from "../ArticleSection";
import {
  getAgentConfigs,
  getProjectOverride,
  listConfigStylePanels,
} from "../../../api/writer-client";

beforeEach(() => {
  vi.mocked(getAgentConfigs).mockResolvedValue({
    agents: {
      "writer.opening": {
        agentKey: "writer.opening",
        model: { cli: "claude", model: "claude-opus-4.6" },
        styleBinding: { account: "acctA", role: "opening" },
      },
      "writer.closing": {
        agentKey: "writer.closing",
        model: { cli: "claude", model: "claude-opus-4.6" },
      },
    },
  });
  vi.mocked(getProjectOverride).mockResolvedValue({ agents: {} });
  vi.mocked(listConfigStylePanels).mockResolvedValue({
    panels: [
      {
        account: "acctA",
        role: "opening",
        version: 3,
        status: "active",
        created_at: "",
        source_article_count: 0,
        absPath: "",
        is_legacy: false,
      },
    ],
  });
});

describe("ArticleSection style badge", () => {
  it("shows 🎨 {account}/{role} v{N} badge for bound writer.opening section", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    await waitFor(() =>
      expect(screen.getByTestId("style-badge-opening")).toHaveTextContent(/acctA\/opening v3/),
    );
  });

  it("shows ⚠️ 未绑定 for writer.closing with no style", async () => {
    render(<ArticleSection projectId="p1" status="writing_ready" />);
    await waitFor(() =>
      expect(screen.getByTestId("style-badge-closing")).toHaveTextContent(/未绑定/),
    );
  });
});

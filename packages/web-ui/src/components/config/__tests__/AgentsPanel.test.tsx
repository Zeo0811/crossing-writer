import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

vi.mock("../../../api/writer-client.js", () => {
  return {
    getAgentConfigs: vi.fn(),
    setAgentConfig: vi.fn(),
    listConfigStylePanels: vi.fn(),
  };
});

import { AgentsPanel } from "../AgentsPanel.js";
import {
  getAgentConfigs,
  setAgentConfig,
  listConfigStylePanels,
  type AgentConfigEntry,
  type StylePanel,
} from "../../../api/writer-client.js";

const PANELS: StylePanel[] = [
  {
    account: "acctA",
    role: "opening",
    version: 1,
    status: "active",
    created_at: "2025-01-01T00:00:00Z",
    source_article_count: 5,
    absPath: "/x",
    is_legacy: false,
  },
];

const AGENTS: Record<string, AgentConfigEntry> = {
  "writer.opening": {
    agentKey: "writer.opening",
    model: { cli: "claude", model: "claude-opus-4.6" },
    promptVersion: "writer-opening@v1",
    tools: { search_wiki: true, search_raw: true },
  },
  "coordinator": {
    agentKey: "coordinator",
    model: { cli: "claude", model: "claude-opus-4.6" },
    promptVersion: "coordinator@v1",
  },
};

beforeEach(() => {
  vi.mocked(getAgentConfigs).mockResolvedValue({ agents: AGENTS });
  vi.mocked(listConfigStylePanels).mockResolvedValue({ panels: PANELS });
  vi.mocked(setAgentConfig).mockResolvedValue(undefined);
});

describe("AgentsPanel", () => {
  it("fetches configs & panels on mount and renders agents grouped by step", async () => {
    render(<AgentsPanel />);
    await waitFor(() => {
      expect(screen.getByText("writer.opening")).toBeInTheDocument();
    });
    expect(getAgentConfigs).toHaveBeenCalledTimes(1);
    expect(listConfigStylePanels).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Step 1/)).toBeInTheDocument();
    expect(screen.getByText(/Step 4/)).toBeInTheDocument();
    expect(screen.getByText("coordinator")).toBeInTheDocument();
  });

  it("changing one card calls setAgentConfig and refreshes", async () => {
    render(<AgentsPanel />);
    await waitFor(() => {
      expect(screen.getByText("writer.opening")).toBeInTheDocument();
    });
    const cards = screen.getAllByTestId(/^agent-model-select$/);
    fireEvent.change(cards[0]!, { target: { value: "codex::gpt-5" } });
    await waitFor(() => {
      expect(setAgentConfig).toHaveBeenCalled();
    }, { timeout: 2000 });
    const call = vi.mocked(setAgentConfig).mock.calls[0]!;
    expect(call[0]).toMatch(/^[\w.-]+$/);
    expect(call[1].model.cli).toBe("codex");
  });
});

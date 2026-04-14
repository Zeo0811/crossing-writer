import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../api/writer-client.js", () => ({
  getAgentConfigs: vi.fn(),
  getProjectOverride: vi.fn(),
  setProjectOverride: vi.fn(),
  clearProjectAgentOverride: vi.fn(),
  listConfigStylePanels: vi.fn(),
}));

import { ProjectOverridePanel } from "../ProjectOverridePanel.js";
import {
  getAgentConfigs,
  getProjectOverride,
  setProjectOverride,
  clearProjectAgentOverride,
  listConfigStylePanels,
  type AgentConfigEntry,
  type StylePanel,
} from "../../../api/writer-client.js";

const AGENTS: Record<string, AgentConfigEntry> = {
  "writer.opening": {
    agentKey: "writer.opening",
    model: { cli: "claude", model: "claude-opus-4.6" },
    styleBinding: { account: "acctA", role: "opening" },
  },
  "writer.practice": {
    agentKey: "writer.practice",
    model: { cli: "claude", model: "claude-sonnet-4.5" },
    styleBinding: { account: "acctA", role: "practice" },
  },
  "writer.closing": {
    agentKey: "writer.closing",
    model: { cli: "claude", model: "claude-opus-4.6" },
  },
};

const PANELS: StylePanel[] = [
  {
    account: "acctA",
    role: "opening",
    version: 2,
    status: "active",
    created_at: "2025-01-02T00:00:00Z",
    source_article_count: 5,
    absPath: "/x/acctA/opening/v2.md",
    is_legacy: false,
  },
  {
    account: "acctB",
    role: "opening",
    version: 1,
    status: "active",
    created_at: "2025-01-03T00:00:00Z",
    source_article_count: 3,
    absPath: "/x/acctB/opening/v1.md",
    is_legacy: false,
  },
];

beforeEach(() => {
  vi.mocked(getAgentConfigs).mockReset();
  vi.mocked(getProjectOverride).mockReset();
  vi.mocked(setProjectOverride).mockReset();
  vi.mocked(clearProjectAgentOverride).mockReset();
  vi.mocked(listConfigStylePanels).mockReset();
  vi.mocked(getAgentConfigs).mockResolvedValue({ agents: AGENTS });
  vi.mocked(getProjectOverride).mockResolvedValue({ agents: {} });
  vi.mocked(setProjectOverride).mockResolvedValue(undefined);
  vi.mocked(clearProjectAgentOverride).mockResolvedValue(undefined);
  vi.mocked(listConfigStylePanels).mockResolvedValue({ panels: PANELS });
});

describe("ProjectOverridePanel", () => {
  it("renders writer.* agents with 默认 option", async () => {
    render(<ProjectOverridePanel projectId="p1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("writer.opening")).toBeInTheDocument());
    expect(screen.getByText("writer.practice")).toBeInTheDocument();
    expect(screen.getByText("writer.closing")).toBeInTheDocument();
    expect(getProjectOverride).toHaveBeenCalledWith("p1");
  });

  it("setting model override and saving calls setProjectOverride with merged override", async () => {
    render(<ProjectOverridePanel projectId="p1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("writer.opening")).toBeInTheDocument());

    const modelSel = screen.getByTestId("override-model-writer.opening") as HTMLSelectElement;
    fireEvent.change(modelSel, { target: { value: "codex::gpt-5" } });

    fireEvent.click(screen.getByRole("button", { name: /保存/ }));

    await waitFor(() => expect(setProjectOverride).toHaveBeenCalled());
    const [pid, payload] = vi.mocked(setProjectOverride).mock.calls[0]!;
    expect(pid).toBe("p1");
    expect(payload.agents["writer.opening"]?.model).toEqual({ cli: "codex", model: "gpt-5" });
  });

  it("clear override button calls clearProjectAgentOverride for that agent", async () => {
    vi.mocked(getProjectOverride).mockResolvedValue({
      agents: { "writer.opening": { model: { cli: "codex", model: "gpt-5" } } },
    });
    render(<ProjectOverridePanel projectId="p1" onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText("writer.opening")).toBeInTheDocument());

    const clearBtn = screen.getByTestId("clear-override-writer.opening");
    fireEvent.click(clearBtn);
    await waitFor(() => expect(clearProjectAgentOverride).toHaveBeenCalledWith("p1", "writer.opening"));
  });

  it("cancel calls onClose without saving", async () => {
    const onClose = vi.fn();
    render(<ProjectOverridePanel projectId="p1" onClose={onClose} />);
    await waitFor(() => expect(screen.getByText("writer.opening")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /取消/ }));
    expect(onClose).toHaveBeenCalled();
    expect(setProjectOverride).not.toHaveBeenCalled();
  });
});

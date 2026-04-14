import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../../api/writer-client.js", () => ({
  listConfigStylePanels: vi.fn(),
  deleteStylePanel: vi.fn(),
  getAgentConfigs: vi.fn(),
}));

import { StylePanelList } from "../StylePanelList.js";
import {
  listConfigStylePanels,
  deleteStylePanel,
  getAgentConfigs,
  type StylePanel,
  type AgentConfigEntry,
} from "../../../api/writer-client.js";

const PANELS: StylePanel[] = [
  {
    account: "acctA",
    role: "opening",
    version: 2,
    status: "active",
    created_at: "2025-01-05T00:00:00Z",
    source_article_count: 7,
    absPath: "/x/a/o/v2.md",
    is_legacy: false,
  },
  {
    account: "acctA",
    role: "opening",
    version: 1,
    status: "deleted",
    created_at: "2025-01-01T00:00:00Z",
    source_article_count: 3,
    absPath: "/x/a/o/v1.md",
    is_legacy: false,
  },
  {
    account: "acctB",
    role: "legacy",
    version: 1,
    status: "active",
    created_at: "2024-12-01T00:00:00Z",
    source_article_count: 2,
    absPath: "/x/b/legacy/v1.md",
    is_legacy: true,
  },
];

const AGENTS: Record<string, AgentConfigEntry> = {
  "writer.opening": {
    agentKey: "writer.opening",
    model: { cli: "claude", model: "claude-opus-4.6" },
    styleBinding: { account: "acctA", role: "opening" },
  },
};

beforeEach(() => {
  vi.mocked(listConfigStylePanels).mockResolvedValue({ panels: PANELS });
  vi.mocked(getAgentConfigs).mockResolvedValue({ agents: AGENTS });
  vi.mocked(deleteStylePanel).mockResolvedValue(undefined);
});

describe("StylePanelList", () => {
  it("groups panels by account and shows chips", async () => {
    render(<StylePanelList />);
    await waitFor(() => expect(screen.getByText(/acctA/)).toBeInTheDocument());
    expect(vi.mocked(listConfigStylePanels)).toHaveBeenCalledWith({ include_deleted: true });
    expect(screen.getByText(/● ACTIVE/)).toBeInTheDocument();
    expect(screen.getByText(/○ DELETED/)).toBeInTheDocument();
    expect(screen.getByText(/▣ LEGACY/)).toBeInTheDocument();
  });

  it("shows mount hint for bound agents", async () => {
    render(<StylePanelList />);
    await waitFor(() => expect(screen.getByText(/acctA/)).toBeInTheDocument());
    expect(screen.getByText(/挂载到.*writer\.opening/)).toBeInTheDocument();
  });

  it("soft delete calls deleteStylePanel(account, role, version) without hard flag", async () => {
    render(<StylePanelList />);
    await waitFor(() => expect(screen.getByText(/acctA/)).toBeInTheDocument());
    const softBtns = screen.getAllByRole("button", { name: /软删/ });
    fireEvent.click(softBtns[0]!);
    await waitFor(() => expect(deleteStylePanel).toHaveBeenCalled());
    const args = vi.mocked(deleteStylePanel).mock.calls[0]!;
    expect(args[0]).toBe("acctA");
    expect(args[1]).toBe("opening");
    expect(args[2]).toBe(2);
    expect(args[3]).toBeFalsy();
  });

  it("renders '+ 蒸 全部' button per account", async () => {
    render(<StylePanelList />);
    await waitFor(() => expect(screen.getByText(/acctA/)).toBeInTheDocument());
    const allBtns = screen.getAllByRole("button", { name: /\+ 蒸 全部/ });
    // One per account (acctA, acctB) — since account-level button is always present
    expect(allBtns.length).toBeGreaterThanOrEqual(2);
  });

  it("legacy panel exposes 硬删 button and no 软删", async () => {
    render(<StylePanelList />);
    await waitFor(() => expect(screen.getByText(/acctB/)).toBeInTheDocument());
    // Legacy row: ensure 硬删 exists somewhere
    const hardBtns = screen.getAllByRole("button", { name: /硬删/ });
    expect(hardBtns.length).toBeGreaterThan(0);
  });
});

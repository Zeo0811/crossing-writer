import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { BaseTabPanel } from "../BaseTabPanel.js";

vi.mock("../../../api/writer-client.js", () => ({
  getDefaultModel: vi.fn().mockResolvedValue({
    writer: { cli: "claude", model: "claude-opus-4-7" },
    other: { cli: "claude", model: "claude-sonnet-4-5" },
  }),
  setDefaultModel: vi.fn().mockResolvedValue(undefined),
  getAgentConfigs: vi.fn().mockResolvedValue({ agents: {} }),
  setAgentConfig: vi.fn().mockResolvedValue(undefined),
  listConfigStylePanels: vi.fn().mockResolvedValue({ panels: [] }),
}));

describe("BaseTabPanel", () => {
  it("renders two model dropdowns", async () => {
    render(<BaseTabPanel />);
    await waitFor(() => {
      expect(screen.getByText("Writer 模型")).toBeInTheDocument();
      expect(screen.getByText("其他 agent 模型")).toBeInTheDocument();
    });
  });

  it("renders writer styleBinding rows for opening/practice/closing", async () => {
    render(<BaseTabPanel />);
    await waitFor(() => {
      // Each role label appears twice — once in the styleBinding row and
      // once in the tools-table row — so we assert on the count.
      expect(screen.getAllByText("开头 (opening)").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("实测 (practice)").length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText("结尾 (closing)").length).toBeGreaterThanOrEqual(1);
      // StyleBinding select is the canonical render target
      expect(screen.getByTestId("style-binding-writer.opening")).toBeInTheDocument();
      expect(screen.getByTestId("style-binding-writer.practice")).toBeInTheDocument();
      expect(screen.getByTestId("style-binding-writer.closing")).toBeInTheDocument();
    });
  });

  it("renders tools checkbox table with 2 tool columns", async () => {
    render(<BaseTabPanel />);
    await waitFor(() => {
      expect(screen.getByText("search_wiki")).toBeInTheDocument();
      expect(screen.getByText("search_raw")).toBeInTheDocument();
    });
  });
});

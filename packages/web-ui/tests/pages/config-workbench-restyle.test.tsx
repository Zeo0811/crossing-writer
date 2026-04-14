import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConfigWorkbench } from "../../src/pages/ConfigWorkbench";

vi.mock("../../src/api/writer-client.js", () => ({
  getAgentConfigs: vi.fn(async () => ({ agents: {} })),
  listStylePanels: vi.fn(async () => []),
  setAgentConfig: vi.fn(),
}));

describe("ConfigWorkbench restyle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders TopNav and page-config-workbench testid", async () => {
    render(
      <MemoryRouter>
        <ConfigWorkbench />
      </MemoryRouter>
    );
    expect(screen.getByTestId("page-config-workbench")).toBeInTheDocument();
    expect(screen.getByTestId("topnav")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("配置工作台")).toBeInTheDocument());
  });
});

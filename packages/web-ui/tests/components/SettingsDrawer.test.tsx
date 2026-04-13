import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsDrawer } from "../../src/components/settings/SettingsDrawer";
import { ToastProvider } from "../../src/components/ui/ToastProvider";

vi.mock("../../src/api/config-client", () => ({
  getAgentsConfig: vi.fn(async () => ({
    defaultCli: "claude",
    fallbackCli: "codex",
    agents: { "brief_analyst": { cli: "claude", model: "sonnet" } },
  })),
  patchAgentsConfig: vi.fn(async () => {}),
}));

function wrap(ui: React.ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("SettingsDrawer", () => {
  it("closed by default, opens when open=true", () => {
    const onClose = vi.fn();
    wrap(<SettingsDrawer open={false} onClose={onClose} />);
    expect(screen.queryByText(/默认 CLI/)).toBeNull();
  });

  it("loads config when open", async () => {
    wrap(<SettingsDrawer open={true} onClose={() => {}} />);
    await waitFor(() => screen.getByText(/默认 CLI/));
    expect(screen.getByDisplayValue("sonnet")).toBeInTheDocument();
  });

  it("patches on save", async () => {
    const { patchAgentsConfig } = await import("../../src/api/config-client");
    const onClose = vi.fn();
    wrap(<SettingsDrawer open={true} onClose={onClose} />);
    await waitFor(() => screen.getByText(/默认 CLI/));
    fireEvent.click(screen.getByRole("button", { name: /保存/ }));
    await waitFor(() => {
      expect(patchAgentsConfig).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });
});

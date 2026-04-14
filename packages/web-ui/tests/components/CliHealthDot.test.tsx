import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CliHealthDot } from "../../src/components/status/CliHealthDot";

const onlineItem = { status: "online", version: "1.4.2", checkedAt: "2026-04-14T00:00:00Z" } as const;
const offlineItem = { status: "offline", error: "command not found", checkedAt: "2026-04-14T00:00:00Z" } as const;

describe("CliHealthDot", () => {
  it("renders online label with version in popover", () => {
    render(<CliHealthDot label="CLAUDE" item={onlineItem as any} />);
    const dot = screen.getByLabelText(/CLAUDE online/i);
    fireEvent.mouseEnter(dot);
    expect(screen.getByText(/v1\.4\.2/)).toBeInTheDocument();
  });

  it("shows install + login commands when offline and fires onCopy", async () => {
    const onCopy = vi.fn().mockResolvedValue(undefined);
    render(<CliHealthDot label="CLAUDE" item={offlineItem as any} onCopy={onCopy} />);
    fireEvent.mouseEnter(screen.getByLabelText(/CLAUDE offline/i));
    const dialog = screen.getByRole("dialog");
    const buttons = within(dialog).getAllByRole("button", { name: /copy/i });
    fireEvent.click(buttons[0]!);
    expect(onCopy).toHaveBeenCalledWith("npm i -g @anthropic-ai/claude-code");
    fireEvent.click(buttons[1]!);
    expect(onCopy).toHaveBeenCalledWith("claude /login");
  });

  it("renders red (not online) when offline", () => {
    render(<CliHealthDot label="CODEX" item={offlineItem as any} />);
    const dot = screen.getByLabelText(/CODEX offline/i);
    expect(dot).toBeInTheDocument();
  });
});

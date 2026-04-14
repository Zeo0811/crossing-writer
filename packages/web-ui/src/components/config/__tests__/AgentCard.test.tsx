import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AgentCard } from "../AgentCard.js";
import type { AgentConfigEntry, StylePanel } from "../../../api/writer-client.js";

const MODEL_CHOICES = [
  { cli: "claude" as const, model: "claude-opus-4.6", label: "claude claude-opus-4.6" },
  { cli: "codex" as const, model: "gpt-5", label: "codex gpt-5" },
];

const ACTIVE_STYLE_PANELS: StylePanel[] = [
  {
    account: "acctA",
    role: "opening",
    version: 2,
    status: "active",
    created_at: "2025-01-02T00:00:00Z",
    source_article_count: 5,
    absPath: "/tmp/acctA/opening/v2.md",
    is_legacy: false,
  },
  {
    account: "acctB",
    role: "opening",
    version: 1,
    status: "active",
    created_at: "2025-01-03T00:00:00Z",
    source_article_count: 3,
    absPath: "/tmp/acctB/opening/v1.md",
    is_legacy: false,
  },
];

function baseCfg(): AgentConfigEntry {
  return {
    agentKey: "writer.opening",
    model: { cli: "claude", model: "claude-opus-4.6" },
    promptVersion: "writer-opening@v1",
    tools: { search_wiki: true, search_raw: false },
  };
}

describe("AgentCard", () => {
  it("renders agent key, active status, model and tool checkboxes", () => {
    const cfg: AgentConfigEntry = {
      ...baseCfg(),
      styleBinding: { account: "acctA", role: "opening" },
    };
    render(
      <AgentCard
        agentKey="writer.opening"
        agentConfig={cfg}
        stylePanelChoices={ACTIVE_STYLE_PANELS}
        modelChoices={MODEL_CHOICES}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("writer.opening")).toBeInTheDocument();
    expect(screen.getByText(/ACTIVE/)).toBeInTheDocument();
    expect(screen.getByLabelText("search_wiki")).toBeChecked();
    expect(screen.getByLabelText("search_raw")).not.toBeChecked();
    expect(screen.getByText(/writer-opening@v1/)).toBeInTheDocument();
  });

  it("shows style_not_bound when styleBinding missing for writer.*", () => {
    render(
      <AgentCard
        agentKey="writer.opening"
        agentConfig={baseCfg()}
        stylePanelChoices={ACTIVE_STYLE_PANELS}
        modelChoices={MODEL_CHOICES}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText(/style_not_bound/)).toBeInTheDocument();
  });

  it("changing model fires onChange (debounced) with merged cfg", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <AgentCard
        agentKey="writer.opening"
        agentConfig={baseCfg()}
        stylePanelChoices={ACTIVE_STYLE_PANELS}
        modelChoices={MODEL_CHOICES}
        onChange={onChange}
      />,
    );
    const sel = screen.getByTestId("agent-model-select") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "codex::gpt-5" } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(450); });
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0]![0] as AgentConfigEntry;
    expect(arg.model).toEqual({ cli: "codex", model: "gpt-5" });
    expect(arg.agentKey).toBe("writer.opening");
    vi.useRealTimers();
  });

  it("changing style dropdown fires onChange with new styleBinding", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <AgentCard
        agentKey="writer.opening"
        agentConfig={baseCfg()}
        stylePanelChoices={ACTIVE_STYLE_PANELS}
        modelChoices={MODEL_CHOICES}
        onChange={onChange}
      />,
    );
    const sel = screen.getByTestId("agent-style-select") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "acctA::opening" } });
    act(() => { vi.advanceTimersByTime(450); });
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0]![0] as AgentConfigEntry;
    expect(arg.styleBinding).toEqual({ account: "acctA", role: "opening" });
    vi.useRealTimers();
  });

  it("selecting (none) clears styleBinding", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const cfg: AgentConfigEntry = {
      ...baseCfg(),
      styleBinding: { account: "acctA", role: "opening" },
    };
    render(
      <AgentCard
        agentKey="writer.opening"
        agentConfig={cfg}
        stylePanelChoices={ACTIVE_STYLE_PANELS}
        modelChoices={MODEL_CHOICES}
        onChange={onChange}
      />,
    );
    const sel = screen.getByTestId("agent-style-select") as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "" } });
    act(() => { vi.advanceTimersByTime(450); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].styleBinding).toBeUndefined();
    vi.useRealTimers();
  });

  it("toggling tool checkbox fires onChange with updated tools map", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <AgentCard
        agentKey="writer.opening"
        agentConfig={baseCfg()}
        stylePanelChoices={ACTIVE_STYLE_PANELS}
        modelChoices={MODEL_CHOICES}
        onChange={onChange}
      />,
    );
    const box = screen.getByLabelText("search_raw") as HTMLInputElement;
    fireEvent.click(box);
    act(() => { vi.advanceTimersByTime(450); });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0].tools).toEqual({ search_wiki: true, search_raw: true });
    vi.useRealTimers();
  });

  it("does not render tools row for non-writer agent", () => {
    const cfg: AgentConfigEntry = {
      agentKey: "coordinator",
      model: { cli: "claude", model: "claude-opus-4.6" },
      promptVersion: "coordinator@v1",
    };
    render(
      <AgentCard
        agentKey="coordinator"
        agentConfig={cfg}
        stylePanelChoices={[]}
        modelChoices={MODEL_CHOICES}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText("search_wiki")).toBeNull();
  });
});

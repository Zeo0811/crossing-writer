import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SectionStatusBadge } from "../../src/components/status/SectionStatusBadge";

describe("SectionStatusBadge", () => {
  it("running: shows count + green dot", () => {
    render(
      <SectionStatusBadge
        sectionKey="case"
        projectStatus="case_planning_running"
        activeAgents={[
          { agent: "case_expert.A", stage: "round1_started", status: "online" },
          { agent: "case_expert.B", stage: "round1_started", status: "online" },
        ]}
        events={[
          { ts: "t1", type: "case_expert.round1_started", agent: "case_expert.A" },
          { ts: "t2", type: "case_expert.round1_started", agent: "case_expert.B" },
        ]}
      />
    );
    expect(screen.getByTestId("section-badge").textContent).toMatch(/2\/2.*运行中/);
    expect(screen.getByTestId("section-badge").className).toMatch(/green/);
  });

  it("failed: shows 失败 red", () => {
    render(
      <SectionStatusBadge
        sectionKey="overview"
        projectStatus="overview_failed"
        activeAgents={[]}
        events={[{ ts: "t1", type: "overview.failed", agent: "product_overview" }]}
      />
    );
    expect(screen.getByTestId("section-badge").textContent).toMatch(/失败/);
    expect(screen.getByTestId("section-badge").className).toMatch(/red/);
  });

  it("completed section when project advanced", () => {
    render(
      <SectionStatusBadge
        sectionKey="brief"
        projectStatus="case_planning_running"
        activeAgents={[]}
        events={[]}
      />
    );
    expect(screen.getByTestId("section-badge").textContent).toMatch(/completed/);
  });

  it("pending: future section shows 待开始", () => {
    render(
      <SectionStatusBadge
        sectionKey="case"
        projectStatus="awaiting_overview_input"
        activeAgents={[]}
        events={[]}
      />
    );
    expect(screen.getByTestId("section-badge").textContent).toMatch(/待开始/);
  });

  it("active: current section, no agent running yet", () => {
    render(
      <SectionStatusBadge
        sectionKey="overview"
        projectStatus="awaiting_overview_input"
        activeAgents={[]}
        events={[]}
      />
    );
    expect(screen.getByTestId("section-badge").textContent).toMatch(/进行中/);
  });
});

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SectionAccordion, Section } from "../../src/components/layout/SectionAccordion";

describe("SectionAccordion", () => {
  it("completed sections collapse by default", () => {
    render(
      <SectionAccordion>
        <Section title="Brief" status="completed">
          <div>brief content</div>
        </Section>
        <Section title="Overview" status="active">
          <div>overview content</div>
        </Section>
      </SectionAccordion>,
    );
    expect(screen.queryByText("brief content")).toBeNull();
    expect(screen.getByText("overview content")).toBeInTheDocument();
  });

  it("toggles on click for completed section", () => {
    render(
      <SectionAccordion>
        <Section title="Brief" status="completed">
          <div>brief content</div>
        </Section>
      </SectionAccordion>,
    );
    fireEvent.click(screen.getByText("Brief"));
    expect(screen.getByText("brief content")).toBeInTheDocument();
  });

  it("pending section cannot be expanded", () => {
    render(
      <SectionAccordion>
        <Section title="Cases" status="pending">
          <div>case content</div>
        </Section>
      </SectionAccordion>,
    );
    fireEvent.click(screen.getByText("Cases"));
    expect(screen.queryByText("case content")).toBeNull();
  });
});

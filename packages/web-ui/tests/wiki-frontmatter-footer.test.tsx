import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WikiFrontmatterFooter } from "../src/components/wiki/WikiFrontmatterFooter";

const fm = {
  type: "entity" as const,
  title: "阶跃星辰",
  sources: [
    { account: "十字路口Crossing", article_id: "abc12345def67890", quoted: "阶跃星辰是其中走得比较快的一个。" },
  ],
  backlinks: ["entities/StepClaw.md", "concepts/agent.md"],
  images: [{ url: "https://example.com/a.png", caption: "图 1" }],
  last_ingest: "2026-04-16T00:00:00Z",
};

describe("WikiFrontmatterFooter", () => {
  it("renders sources with account + short id + quoted", () => {
    render(<WikiFrontmatterFooter frontmatter={fm} onNavigate={() => {}} onOpenSource={() => {}} knownPaths={new Set(["entities/StepClaw.md", "concepts/agent.md"])} />);
    expect(screen.getByText("十字路口Crossing")).toBeInTheDocument();
    expect(screen.getByText(/abc12345/)).toBeInTheDocument();
    expect(screen.getByText(/阶跃星辰是其中走得比较快的一个/)).toBeInTheDocument();
  });

  it("click on source triggers onOpenSource with account + id", () => {
    const onOpenSource = vi.fn();
    render(<WikiFrontmatterFooter frontmatter={fm} onNavigate={() => {}} onOpenSource={onOpenSource} knownPaths={new Set()} />);
    fireEvent.click(screen.getByRole("button", { name: /十字路口Crossing.*abc12345/ }));
    expect(onOpenSource).toHaveBeenCalledWith("十字路口Crossing", "abc12345def67890");
  });

  it("click on backlink chip triggers onNavigate", () => {
    const onNavigate = vi.fn();
    render(<WikiFrontmatterFooter frontmatter={fm} onNavigate={onNavigate} onOpenSource={() => {}} knownPaths={new Set(["entities/StepClaw.md", "concepts/agent.md"])} />);
    fireEvent.click(screen.getByRole("button", { name: "entities/StepClaw.md" }));
    expect(onNavigate).toHaveBeenCalledWith("entities/StepClaw.md");
  });

  it("marks unknown backlink paths as disabled", () => {
    render(<WikiFrontmatterFooter frontmatter={fm} onNavigate={() => {}} onOpenSource={() => {}} knownPaths={new Set(["concepts/agent.md"])} />);
    const btn = screen.getByRole("button", { name: "entities/StepClaw.md" });
    expect(btn).toBeDisabled();
  });

  it("renders images with url and caption", () => {
    render(<WikiFrontmatterFooter frontmatter={fm} onNavigate={() => {}} onOpenSource={() => {}} knownPaths={new Set()} />);
    const img = screen.getByAltText("图 1") as HTMLImageElement;
    expect(img.src).toContain("example.com/a.png");
  });

  it("renders nothing when no sources/backlinks/images", () => {
    const { container } = render(
      <WikiFrontmatterFooter
        frontmatter={{ type: "entity", title: "x" }}
        onNavigate={() => {}}
        onOpenSource={() => {}}
        knownPaths={new Set()}
      />,
    );
    expect(container.textContent).toBe("");
  });
});

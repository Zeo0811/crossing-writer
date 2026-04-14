import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CliHealthDot } from "../../src/components/status/CliHealthDot";

describe("CliHealthDot pixel style", () => {
  it("renders a square pixel dot (border-radius 0, 10x10)", () => {
    render(
      <CliHealthDot
        label="CLAUDE"
        item={{ status: "online", version: "1.0", checkedAt: new Date().toISOString() } as any}
      />
    );
    const dot = screen.getByRole("status");
    expect(dot.getAttribute("data-pixel-dot")).toBe("");
    expect((dot as HTMLElement).style.borderRadius).toMatch(/^0/);
    expect((dot as HTMLElement).style.width).toBe("10px");
    expect((dot as HTMLElement).style.height).toBe("10px");
  });

  it("offline state uses --red token", () => {
    render(
      <CliHealthDot
        label="CODEX"
        item={{ status: "offline", error: "cmd not found", checkedAt: new Date().toISOString() } as any}
      />
    );
    const dot = screen.getByRole("status");
    expect((dot as HTMLElement).style.backgroundColor).toMatch(/var\(--red\)/);
  });
});

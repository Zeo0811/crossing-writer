import { describe, it, expect, beforeAll } from "vitest";
import "../../src/styles/tokens.css";

describe("tokens.css", () => {
  beforeAll(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("exposes dark tokens on :root by default", () => {
    const s = getComputedStyle(document.documentElement);
    expect(s.getPropertyValue("--bg-0").trim()).toBe("#081208");
    expect(s.getPropertyValue("--bg-1").trim()).toBe("#0f1a11");
    expect(s.getPropertyValue("--accent").trim()).toBe("#40ff9f");
    expect(s.getPropertyValue("--body").trim()).toBe("#dae3d9");
    expect(s.getPropertyValue("--hair").trim()).toBe("#1e2e21");
  });

  it("switches to light tokens when data-theme=light", () => {
    document.documentElement.setAttribute("data-theme", "light");
    const s = getComputedStyle(document.documentElement);
    expect(s.getPropertyValue("--bg-0").trim()).toBe("#f5f6f7");
    expect(s.getPropertyValue("--bg-1").trim()).toBe("#ffffff");
    expect(s.getPropertyValue("--accent").trim()).toBe("#1f9e5c");
    expect(s.getPropertyValue("--body").trim()).toBe("#1d2126");
    document.documentElement.removeAttribute("data-theme");
  });
});

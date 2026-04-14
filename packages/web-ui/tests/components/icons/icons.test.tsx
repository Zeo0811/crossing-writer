import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  AgentIcon, ToolIcon, StyleIcon, WikiIcon, RawIcon,
  ConfigIcon, DistillIcon, HealthDotIcon, SpriteIcon,
} from "../../../src/components/icons";

const ALL = [AgentIcon, ToolIcon, StyleIcon, WikiIcon, RawIcon, ConfigIcon, DistillIcon, HealthDotIcon, SpriteIcon];

describe("pixel icons", () => {
  it("each icon renders an SVG with crispEdges shape rendering", () => {
    ALL.forEach((Icon) => {
      const { container } = render(<Icon size={16} />);
      const svg = container.querySelector("svg")!;
      expect(svg).toBeTruthy();
      expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");
      expect(svg.getAttribute("width")).toBe("16");
    });
  });

  it("size prop passes through", () => {
    const { container } = render(<AgentIcon size={24} />);
    expect(container.querySelector("svg")!.getAttribute("width")).toBe("24");
  });
});

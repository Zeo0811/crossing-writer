import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SseHealthDot } from "../../src/components/status/SseHealthDot";

describe("SseHealthDot", () => {
  it("green when connected", () => {
    render(<SseHealthDot connectionState="connected" lastEventTs={Date.now()} />);
    expect(screen.getByTestId("sse-dot").className).toMatch(/green/);
  });

  it("yellow when reconnecting", () => {
    render(<SseHealthDot connectionState="reconnecting" lastEventTs={null} />);
    expect(screen.getByTestId("sse-dot").className).toMatch(/yellow/);
  });

  it("red when disconnected", () => {
    render(<SseHealthDot connectionState="disconnected" lastEventTs={null} />);
    expect(screen.getByTestId("sse-dot").className).toMatch(/red/);
  });

  it("gray when connecting (never opened)", () => {
    render(<SseHealthDot connectionState="connecting" lastEventTs={null} />);
    expect(screen.getByTestId("sse-dot").className).toMatch(/gray/);
  });

  it("tooltip includes last event age", () => {
    const fiveSecAgo = Date.now() - 5000;
    render(<SseHealthDot connectionState="connected" lastEventTs={fiveSecAgo} />);
    const dot = screen.getByTestId("sse-dot");
    expect(dot.getAttribute("title")).toMatch(/5/);
  });
});

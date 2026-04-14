import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SkillForm } from "../SkillForm";
import * as client from "../../../api/writer-client";

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("SkillForm", () => {
  it("executes selected tool with args and calls onResult", async () => {
    const result = {
      ok: true as const,
      tool: "search_raw",
      query: "x",
      args: { query: "x", topK: "5" },
      hits: [],
      hits_count: 0,
      formatted: "",
    };
    const spy = vi.spyOn(client, "callSkill").mockResolvedValue(result);
    const onResult = vi.fn();
    const onClose = vi.fn();
    render(
      <SkillForm projectId="p1" sectionKey="opening" onClose={onClose} onResult={onResult} />,
    );
    fireEvent.change(screen.getByLabelText(/工具/), { target: { value: "search_raw" } });
    fireEvent.change(screen.getByLabelText(/参数/), {
      target: { value: '{"query":"x","topK":5}' },
    });
    fireEvent.click(screen.getByRole("button", { name: /执行/ }));
    await waitFor(() => {
      expect(spy).toHaveBeenCalledWith("p1", "opening", "search_raw", {
        query: "x",
        topK: "5",
      });
      expect(onResult).toHaveBeenCalledWith(result);
    });
  });

  it("shows error on invalid json", () => {
    render(
      <SkillForm projectId="p1" sectionKey="opening" onClose={vi.fn()} onResult={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText(/参数/), { target: { value: "{not json" } });
    fireEvent.click(screen.getByRole("button", { name: /执行/ }));
    expect(screen.getByText(/JSON 解析失败/)).toBeInTheDocument();
  });
});

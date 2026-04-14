import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import { WikiSearchBox } from "../src/components/wiki/WikiSearchBox";

describe("WikiSearchBox", () => {
  it("debounces search input by 300ms", async () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    render(<WikiSearchBox onSearch={onSearch} />);
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: "Ali" } });
    fireEvent.change(input, { target: { value: "Alice" } });
    expect(onSearch).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(onSearch).toHaveBeenCalledWith("Alice");
    expect(onSearch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

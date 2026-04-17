import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AccountSidebar } from "../src/components/wiki/AccountSidebar";

const accounts = [
  { account: "AcctA", count: 10, ingested_count: 3 },
  { account: "AcctB", count: 5, ingested_count: 5 },
];

describe("AccountSidebar", () => {
  it("lists accounts with counts", () => {
    render(<AccountSidebar accounts={accounts} active={null} cartPerAccount={new Map()} onSelect={() => {}} />);
    expect(screen.getByText("AcctA")).toBeInTheDocument();
    expect(screen.getByText("AcctB")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("highlights active account", () => {
    render(<AccountSidebar accounts={accounts} active="AcctA" cartPerAccount={new Map()} onSelect={() => {}} />);
    expect(screen.getByTestId("sidebar-item-AcctA")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("sidebar-item-AcctB")).toHaveAttribute("aria-selected", "false");
  });

  it("calls onSelect when account clicked", () => {
    const onSelect = vi.fn();
    render(<AccountSidebar accounts={accounts} active={null} cartPerAccount={new Map()} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("sidebar-item-AcctB"));
    expect(onSelect).toHaveBeenCalledWith("AcctB");
  });

  it("shows cart badge when account has cart items", () => {
    render(<AccountSidebar accounts={accounts} active={null} cartPerAccount={new Map([["AcctA", 3]])} onSelect={() => {}} />);
    expect(screen.getByTestId("sidebar-cart-AcctA")).toHaveTextContent("3");
  });

  it("renders header with account count", () => {
    render(<AccountSidebar accounts={accounts} active={null} cartPerAccount={new Map()} onSelect={() => {}} />);
    expect(screen.getByText(/账号（2）/)).toBeInTheDocument();
  });
});

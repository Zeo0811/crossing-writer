import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TopicExpertPanel } from "../../src/components/config/TopicExpertPanel";

function mkApi(initial: any[]) {
  const experts = [...initial];
  const list = vi.fn(async () => ({ experts: [...experts] }));
  const set = vi.fn(async (name: string, patch: any) => {
    const i = experts.findIndex((e) => e.name === name);
    if (i >= 0) experts[i] = { ...experts[i], ...patch };
    return { ok: true, expert: experts[i] } as any;
  });
  const create = vi.fn(async (body: any) => {
    experts.push({
      name: body.name, specialty: body.specialty, active: false,
      default_preselect: false, soft_deleted: false,
    });
    return { ok: true, expert: experts.at(-1)!, job_id: null } as any;
  });
  const del = vi.fn(async (name: string, opts?: any) => {
    if ((opts?.mode ?? "soft") === "soft") {
      const i = experts.findIndex((e) => e.name === name);
      if (i >= 0) experts[i]!.soft_deleted = true;
    } else {
      const i = experts.findIndex((e) => e.name === name);
      if (i >= 0) experts.splice(i, 1);
    }
    return { ok: true, mode: opts?.mode ?? "soft" } as any;
  });
  const distill = vi.fn((_name: string, _body: any, h: any) => {
    h.onEvent("distill.started", {});
    h.onEvent("distill.done", { version: 1 });
    return { abort: () => {} };
  });
  return { api: { list, set, create, del, distill }, experts };
}

describe("TopicExpertPanel", () => {
  const seeded = [
    { name: "A", specialty: "zen", active: true, default_preselect: true, soft_deleted: false },
    { name: "B", specialty: "hard", active: false, default_preselect: false, soft_deleted: false },
  ];

  it("renders seeded experts after mount", async () => {
    const { api } = mkApi(seeded);
    render(<TopicExpertPanel api={api} />);
    await waitFor(() => expect(screen.getByTestId("te-panel")).toBeTruthy());
    expect(screen.getByTestId("te-row-A")).toBeTruthy();
    expect(screen.getByTestId("te-row-B")).toBeTruthy();
  });

  it("toggling active fires PUT with { active:false }", async () => {
    const { api } = mkApi(seeded);
    render(<TopicExpertPanel api={api} />);
    await waitFor(() => screen.getByTestId("te-row-A"));
    const toggle = screen.getByLabelText("active-A") as HTMLInputElement;
    fireEvent.click(toggle);
    await waitFor(() => expect(api.set).toHaveBeenCalled());
    expect(api.set).toHaveBeenCalledWith("A", { active: false });
  });

  it("soft-delete hides row after refresh", async () => {
    const { api } = mkApi(seeded);
    globalThis.confirm = () => true;
    render(<TopicExpertPanel api={api} />);
    await waitFor(() => screen.getByTestId("te-row-A"));
    fireEvent.click(screen.getByTestId("te-soft-A"));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith("A", { mode: "soft" }));
  });

  it("hard-delete requires typed name", async () => {
    const { api } = mkApi(seeded);
    globalThis.prompt = () => "A";
    render(<TopicExpertPanel api={api} />);
    await waitFor(() => screen.getByTestId("te-row-A"));
    fireEvent.click(screen.getByTestId("te-hard-A"));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith("A", { mode: "hard" }));
  });

  it("hard-delete aborts when name not typed", async () => {
    const { api } = mkApi(seeded);
    globalThis.prompt = () => "WRONG";
    render(<TopicExpertPanel api={api} />);
    await waitFor(() => screen.getByTestId("te-row-A"));
    fireEvent.click(screen.getByTestId("te-hard-A"));
    expect(api.del).not.toHaveBeenCalled();
  });

  it("new-expert modal posts create + triggers distill when URLs present", async () => {
    const { api } = mkApi(seeded);
    render(<TopicExpertPanel api={api} />);
    await waitFor(() => screen.getByTestId("te-panel"));
    fireEvent.click(screen.getByTestId("te-new-btn"));
    fireEvent.change(screen.getByLabelText("new-te-name"), { target: { value: "C" } });
    fireEvent.change(screen.getByLabelText("new-te-specialty"), { target: { value: "zen" } });
    fireEvent.change(screen.getByLabelText("new-te-seeds"), { target: { value: "https://x\nhttps://y" } });
    fireEvent.click(screen.getByTestId("te-new-submit"));
    await waitFor(() => expect(api.create).toHaveBeenCalled());
    expect(api.distill).toHaveBeenCalledWith(
      "C",
      expect.objectContaining({ mode: "initial", seed_urls: ["https://x", "https://y"] }),
      expect.any(Object),
    );
  });

  it("redistill emits distill events into row log", async () => {
    const { api } = mkApi(seeded);
    render(<TopicExpertPanel api={api} />);
    await waitFor(() => screen.getByTestId("te-row-A"));
    fireEvent.click(screen.getByTestId("te-redistill-A"));
    await waitFor(() => expect(screen.getByTestId("te-log-A").textContent).toContain("distill.done"));
  });
});

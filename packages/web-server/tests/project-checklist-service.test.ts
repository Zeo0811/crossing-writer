import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectChecklistService } from "../src/services/project-checklist-service.js";
import { ProjectStore } from "../src/services/project-store.js";
import { StylePanelStore } from "../src/services/style-panel-store.js";
import { ProjectOverrideStore } from "../src/services/project-override-store.js";
import type { AgentConfigStore, AgentConfigEntry } from "../src/services/agent-config-store.js";

function mkAgentStore(initial: Record<string, AgentConfigEntry> = {}): AgentConfigStore {
  const state = { ...initial };
  return {
    getAll: () => state,
    get: (k: string) => state[k] ?? null,
    set: async (k: string, cfg: AgentConfigEntry) => { state[k] = cfg; },
    remove: async (k: string) => { delete state[k]; },
  };
}

function writePanel(vault: string, account: string, role: string, version = 1): void {
  const dir = join(vault, "08_experts", "style-panel", account);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, `${role}-v${version}.md`);
  const fm = [
    "---",
    `account: ${account}`,
    `role: ${role}`,
    `version: ${version}`,
    "status: active",
    "created_at: 2026-04-18T00:00:00Z",
    "source_article_count: 1",
    "---",
    "",
    "body",
  ].join("\n");
  writeFileSync(p, fm, "utf-8");
}

interface Ctx {
  root: string;
  projectsDir: string;
  vault: string;
  projectStore: ProjectStore;
  stylePanelStore: StylePanelStore;
  projectOverrideStore: ProjectOverrideStore;
  agentConfigStore: AgentConfigStore;
  svc: ProjectChecklistService;
}

function setup(agents: Record<string, AgentConfigEntry> = {}): Ctx {
  const root = mkdtempSync(join(tmpdir(), "sp18svc-"));
  const projectsDir = join(root, "projects");
  const vault = join(root, "vault");
  mkdirSync(projectsDir, { recursive: true });
  mkdirSync(vault, { recursive: true });
  const projectStore = new ProjectStore(projectsDir);
  const stylePanelStore = new StylePanelStore(vault);
  const projectOverrideStore = new ProjectOverrideStore(projectsDir);
  const agentConfigStore = mkAgentStore(agents);
  const svc = new ProjectChecklistService({
    projectStore,
    stylePanelStore,
    projectOverrideStore,
    agentConfigStore,
    projectsDir,
  });
  return {
    root,
    projectsDir,
    vault,
    projectStore,
    stylePanelStore,
    projectOverrideStore,
    agentConfigStore,
    svc,
  };
}

function bindAllWriters(ctx: Ctx, account = "acct"): void {
  const roles: Array<"opening" | "practice" | "closing"> = ["opening", "practice", "closing"];
  for (const r of roles) {
    writePanel(ctx.vault, account, r);
    (ctx.agentConfigStore as any).set(`writer.${r}`, {
      agentKey: `writer.${r}`,
      styleBinding: { account, role: r },
    });
  }
}

describe("ProjectChecklistService", () => {
  let ctx: Ctx;
  beforeEach(() => {
    ctx = setup();
  });

  it("returns 7 items in order for a fresh project", async () => {
    const p = await ctx.projectStore.create({ name: "fresh" });
    const cl = await ctx.svc.build(p.id);
    expect(cl).not.toBeNull();
    expect(cl!.items.map((i) => i.step)).toEqual([
      "brief", "topic", "case", "evidence", "styleBindings", "draft", "review",
    ]);
    expect(cl!.items[0]!.status).toBe("todo");
  });

  it("returns null for missing project", async () => {
    expect(await ctx.svc.build("p_nope")).toBeNull();
  });

  it("brief done after brief attached and status advanced", async () => {
    const p = await ctx.projectStore.create({ name: "b" });
    await ctx.projectStore.update(p.id, {
      status: "brief_ready" as any,
      brief: {
        source_type: "md",
        raw_path: "x",
        md_path: "x.md",
        summary_path: null,
        uploaded_at: "2026-04-18T00:00:00Z",
      },
    });
    const cl = await ctx.svc.build(p.id);
    expect(cl!.items.find((i) => i.step === "brief")!.status).toBe("done");
  });

  it("topic partial with candidates but no selection", async () => {
    const p = await ctx.projectStore.create({ name: "t" });
    await ctx.projectStore.update(p.id, {
      mission: {
        candidates_path: "m.md",
        selected_index: null,
        selected_path: null,
        selected_at: null,
        selected_by: null,
      },
    });
    const cl = await ctx.svc.build(p.id);
    expect(cl!.items.find((i) => i.step === "topic")!.status).toBe("partial");
  });

  it("case partial when plan is draft", async () => {
    const p = await ctx.projectStore.create({ name: "c" });
    await ctx.projectStore.update(p.id, {
      case_plan: { status: "draft" } as any,
    } as any);
    const cl = await ctx.svc.build(p.id);
    const step = cl!.items.find((i) => i.step === "case")!;
    expect(step.status).toBe("partial");
    expect(step.reason).toContain("draft");
  });

  it("evidence done when evidence_skipped flag set", async () => {
    const p = await ctx.projectStore.create({ name: "e" });
    await ctx.projectStore.update(p.id, {
      flags: { evidence_skipped: true },
    } as any);
    const cl = await ctx.svc.build(p.id);
    expect(cl!.items.find((i) => i.step === "evidence")!.status).toBe("done");
  });

  it("styleBindings blocked when a writer role has no binding", async () => {
    const p = await ctx.projectStore.create({ name: "s" });
    const cl = await ctx.svc.build(p.id);
    const step = cl!.items.find((i) => i.step === "styleBindings")!;
    expect(step.status).toBe("blocked");
    expect(step.reason).toMatch(/writer\.(opening|practice|closing)/);
  });

  it("styleBindings done when all 3 writer roles have active panels", async () => {
    const p = await ctx.projectStore.create({ name: "sd" });
    bindAllWriters(ctx);
    const cl = await ctx.svc.build(p.id);
    expect(cl!.items.find((i) => i.step === "styleBindings")!.status).toBe("done");
  });

  it("draft partial with 1 of 3 sections", async () => {
    const p = await ctx.projectStore.create({ name: "d" });
    const dir = ctx.projectStore.projectDir(p.id);
    const sections = join(dir, "article", "sections");
    mkdirSync(sections, { recursive: true });
    writeFileSync(
      join(sections, "opening.md"),
      "---\nsection: opening\nlast_agent: w\nlast_updated_at: 2026-04-18T00:00:00Z\n---\n\nhello body\n",
      "utf-8",
    );
    const cl = await ctx.svc.build(p.id);
    const step = cl!.items.find((i) => i.step === "draft")!;
    expect(step.status).toBe("partial");
    expect(step.reason).toContain("1/3");
  });

  it("review warning when draft done but no report", async () => {
    const p = await ctx.projectStore.create({ name: "r" });
    const dir = ctx.projectStore.projectDir(p.id);
    const sections = join(dir, "article", "sections");
    mkdirSync(join(sections, "practice"), { recursive: true });
    const fm = (k: string) => `---\nsection: ${k}\nlast_agent: w\nlast_updated_at: 2026-04-18T00:00:00Z\n---\n\nbody for ${k}\n`;
    writeFileSync(join(sections, "opening.md"), fm("opening"), "utf-8");
    writeFileSync(join(sections, "closing.md"), fm("closing"), "utf-8");
    writeFileSync(join(sections, "practice", "case-01.md"), fm("practice.case-01"), "utf-8");
    const cl = await ctx.svc.build(p.id);
    expect(cl!.items.find((i) => i.step === "draft")!.status).toBe("done");
    expect(cl!.items.find((i) => i.step === "review")!.status).toBe("warning");
  });

  it("review done when style_critic_report.json exists", async () => {
    const p = await ctx.projectStore.create({ name: "rd" });
    const dir = ctx.projectStore.projectDir(p.id);
    writeFileSync(join(dir, "style_critic_report.json"), "{}", "utf-8");
    const cl = await ctx.svc.build(p.id);
    expect(cl!.items.find((i) => i.step === "review")!.status).toBe("done");
  });
});

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  runWriterBookend, runWriterPractice, runStyleCritic,
  PracticeStitcherAgent,
  invokeAgent,
  type ReferenceAccountKb,
  type ChatMessage,
  type WriterToolEvent,
  type WriterRunResult,
  type ToolUsage,
} from "@crossing/agents";
import { dispatchSkill } from "@crossing/kb";
import yaml from "js-yaml";
import type { ProjectStore } from "./project-store.js";
import { appendEvent } from "./event-log.js";
import { ArticleStore, type SectionKey } from "./article-store.js";
import type { StylePanel } from "./style-panel-types.js";
import {
  type ContextBundleService,
  renderContextBlock,
  trimToBudget,
  type ContextBundle,
} from "./context-bundle-service.js";
import { collectProjectImages } from "./brief-images.js";
import type { HardRulesStore } from "./hard-rules-store.js";

export class MissingArticleTypeError extends Error {
  constructor(public projectId: string) {
    super(`project ${projectId} has no article_type; please set it in Brief stage`);
    this.name = 'MissingArticleTypeError';
  }
}

export type WriterAgentKey =
  | "writer.opening" | "writer.practice" | "writer.closing"
  | "practice.stitcher" | "style_critic";

export interface WriterConfig {
  cli_model_per_agent: Partial<Record<WriterAgentKey, { cli: "claude" | "codex"; model?: string }>>;
  reference_accounts_per_agent: Partial<Record<WriterAgentKey, string[]>>;
}

export interface ResolvedStyle {
  panel: StylePanel;
  typeSection: string;       // v2: only the section for the current article_type
  hardRulesBlock: string;    // pre-rendered markdown block; empty string if no store wired
}

/**
 * Higher-order resolver supplied by the route layer (which has access to
 * AgentConfigStore + ProjectOverrideStore + StylePanelStore via deps).
 *
 * Contract:
 * - Return `null` when the agent has no styleBinding configured (legacy /
 *   backward-compat path — no injection, no block).
 * - Return `{ panel, typeSection, hardRulesBlock }` when a binding resolves to an active panel.
 * - Throw `StyleNotBoundError` (or any error with `{ binding, reason }`
 *   shape) when a binding exists but is unresolvable — orchestrator will
 *   treat this as a blocker and emit `run.blocked`.
 */
export type ResolveStyleForAgent = (
  agentKey: WriterAgentKey,
) => Promise<ResolvedStyle | null>;

export interface MissingBinding {
  agentKey: string;
  account?: string;
  role?: string;
  reason: string;
  // v2 extras (optional):
  found_version?: number;
  article_type?: string;
  available_types?: string[];
}

export interface RunBlockedResult {
  blocked: true;
  missingBindings: MissingBinding[];
}

export interface RunWriterOpts {
  projectId: string;
  projectsDir: string;
  store: ProjectStore;
  vaultPath: string;
  sqlitePath: string;
  writerConfig: WriterConfig;
  sectionsToRun?: string[];
  /** Optional style-binding resolver (SP-10). If omitted, orchestrator skips
   *  all binding validation/injection for backwards compatibility. */
  resolveStyleForAgent?: ResolveStyleForAgent;
  /** Optional SSE-style event sink used by SP-10 for `run.blocked`. Existing
   *  per-section events are still written via appendEvent regardless. */
  onEvent?: (ev: { type: string; [k: string]: unknown }) => void;
  /** SP-19: optional unified context bundle service. When supplied, a
   *  `[Project Context]` block (built + trimmed) is prepended to every writer
   *  agent user message so all agents share the same project snapshot. */
  contextBundleService?: ContextBundleService;
  /** SP-B.2: optional hard rules store. When supplied, per-role word_count_overrides
   *  are read once per run and passed to opening/closing bookend calls. */
  hardRulesStore?: HardRulesStore;
}

function prependContextBlock(
  userMessage: string,
  bundle: ContextBundle | null,
): string {
  if (!bundle) return userMessage;
  return `${renderContextBlock(bundle)}\n\n${userMessage}`;
}

interface ParsedCase {
  caseId: string;
  name: string;
  description: string;
}

function parseSelectedCases(md: string): ParsedCase[] {
  const body = md.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const re = /^# Case (\d+)\s*[—\-]?\s*(.+?)$([\s\S]*?)(?=^# Case \d+|$)/gm;
  const out: ParsedCase[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const idx = parseInt(m[1]!, 10);
    const caseId = `case-${String(idx).padStart(2, "0")}`;
    out.push({ caseId, name: m[2]!.trim(), description: (m[0] ?? "").trim() });
  }
  return out;
}

async function loadReferenceAccountKb(vaultPath: string, ids: string[]): Promise<ReferenceAccountKb[]> {
  const out: ReferenceAccountKb[] = [];
  for (const id of ids) {
    const p = join(vaultPath, "08_experts", "style-panel", `${id}.md`);
    if (!existsSync(p)) continue;
    const text = await readFile(p, "utf-8");
    out.push({ id, text });
  }
  return out;
}

function resolve(
  key: WriterAgentKey,
  cfg: WriterConfig,
  fallbackCli: "claude" | "codex" = "claude",
): { cli: "claude" | "codex"; model?: string; referenceAccounts: string[] } {
  const cliModel = cfg.cli_model_per_agent[key];
  const refs = cfg.reference_accounts_per_agent[key] ?? [];
  return {
    cli: cliModel?.cli ?? fallbackCli,
    model: cliModel?.model,
    referenceAccounts: refs,
  };
}

function firstLast(text: string, lines = 3): { first: string; last: string } {
  const arr = text.trim().split(/\n+/).filter((l) => l.trim());
  return {
    first: arr.slice(0, lines).join(" "),
    last: arr.slice(-lines).join(" "),
  };
}

function refsBlock(refs: ReferenceAccountKb[]): string {
  return refs.length === 0
    ? "(无参考账号)"
    : refs.map((r) => `## 参考账号：${r.id}\n${r.text}`).join("\n\n");
}

function buildOpeningUserMessage(briefSummary: string, missionSummary: string, productOverview: string, refs: ReferenceAccountKb[]): string {
  return [
    "# Brief 摘要", briefSummary || "(无)", "",
    "# Mission 摘要", missionSummary || "(无)", "",
    "# 产品概览", productOverview || "(无)", "",
    "# 参考账号风格素材", refsBlock(refs), "",
    "请按 system prompt 要求产出开头段正文。",
  ].join("\n");
}

function buildPracticeUserMessage(c: ParsedCase, notesFm: Record<string, unknown>, notesBody: string, shots: string[], refs: ReferenceAccountKb[]): string {
  return [
    `# Case 编号：${c.caseId}`,
    `# Case 名：${c.name}`, "",
    "# Case 详细描述", c.description || "(无)", "",
    "# 实测笔记 frontmatter",
    "```yaml", JSON.stringify(notesFm, null, 2), "```", "",
    "# 实测笔记正文", notesBody || "(无)", "",
    "# 截图清单",
    shots.length === 0 ? "(无)" : shots.map((p, i) => `- screenshot-${i + 1}: ${p}`).join("\n"), "",
    "# 参考账号风格素材", refsBlock(refs), "",
    "请按 system prompt 要求产出该 case 实测小节。",
  ].join("\n");
}

function buildClosingUserMessage(openingText: string, stitchedPracticeText: string, refs: ReferenceAccountKb[]): string {
  return [
    "# 开头段", openingText, "",
    "# 实测主体（含过渡）", stitchedPracticeText, "",
    "# 参考账号风格素材", refsBlock(refs), "",
    "请按 system prompt 要求产出结尾段。",
  ].join("\n");
}

function buildCriticUserMessage(fullArticle: string, sectionKeys: string[], refs: ReferenceAccountKb[]): string {
  return [
    "# 当前 section_keys",
    sectionKeys.map((k) => `- ${k}`).join("\n"), "",
    "# 整篇首拼稿", fullArticle, "",
    "# 参考账号风格素材", refsBlock(refs), "",
    "按 system prompt 格式输出。",
  ].join("\n");
}

function invokerFor(
  agentKey: string,
  cli: "claude" | "codex",
  model?: string,
  runLogDir?: string,
) {
  return async (messages: ChatMessage[], opts?: { images?: string[]; addDirs?: string[] }) => {
    const sys = messages.find((m) => m.role === "system")?.content ?? "";
    const userParts = messages
      .filter((m) => m.role !== "system")
      .map((m) => `[${m.role}]\n${m.content}`)
      .join("\n\n");
    const result = await invokeAgent({
      agentKey,
      cli,
      model,
      systemPrompt: sys,
      userMessage: userParts,
      images: opts?.images,
      addDirs: opts?.addDirs,
      runLogDir,
    });
    return {
      text: result.text,
      meta: {
        cli: result.meta.cli,
        model: result.meta.model ?? undefined,
        durationMs: result.meta.durationMs,
      },
    };
  };
}

function parseCriticRewrites(text: string, allowedKeys: string[]): Record<string, string> {
  const rewrites: Record<string, string> = {};
  if (text.trim() === "NO_CHANGES") return rewrites;
  const re = /##\s+REWRITE\s+section:([^\s\n]+)\s*\n([\s\S]*?)(?=(\n##\s+REWRITE\s+section:)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = m[1]!.trim();
    if (allowedKeys.includes(key)) rewrites[key] = m[2]!.trim();
  }
  return rewrites;
}

function formatStyleReference(resolved: ResolvedStyle): string {
  const { account, role, version } = resolved.panel.frontmatter;
  const hardRules = resolved.hardRulesBlock
    ? `${resolved.hardRulesBlock}\n\n`
    : '';
  return `\n\n${hardRules}# Style Reference — ${account}/${role} v${version}\n\n${resolved.typeSection}\n`;
}

export async function runWriter(
  opts: RunWriterOpts,
): Promise<void | RunBlockedResult> {
  const pDir = join(opts.projectsDir, opts.projectId);
  const articleStore = new ArticleStore(pDir);
  await articleStore.init();

  // --- SP-A: article_type gate -----------------------------------------------
  // Writer v2 requires project.article_type so we know which panel type
  // section to inject. Missing → emit run.blocked (no agents started).
  const project = await opts.store.get(opts.projectId);
  if (!project) {
    throw new Error(`project not found: ${opts.projectId}`);
  }
  if (!project.article_type) {
    opts.onEvent?.({
      type: 'run.blocked',
      reason: 'missing_article_type',
      projectId: opts.projectId,
      missingBindings: [],
    });
    return { blocked: true, missingBindings: [] };
  }
  // ---------------------------------------------------------------------------

  // --- SP-10: Pre-run style-binding validation ------------------------------
  // Gate: if a resolver is supplied, we require every writer.* agent whose
  // section will actually run to resolve to a bound style panel. If any fail,
  // we return early with a RunBlockedResult and emit `run.blocked` without
  // starting any agent and without mutating project status.
  const writerAgents: WriterAgentKey[] = [
    "writer.opening",
    "writer.practice",
    "writer.closing",
  ];
  const resolvedStyles: Partial<Record<WriterAgentKey, ResolvedStyle | null>> = {};
  if (opts.resolveStyleForAgent) {
    const missing: MissingBinding[] = [];
    for (const agentKey of writerAgents) {
      try {
        const r = await opts.resolveStyleForAgent(agentKey);
        resolvedStyles[agentKey] = r;
      } catch (err) {
        const e = err as any;
        const account = e?.binding?.account;
        const role = e?.binding?.role;
        let reason = 'unresolved';
        const extra: Record<string, unknown> = {};
        if (err && typeof err === 'object' && 'name' in err) {
          switch ((err as any).name) {
            case 'StyleVersionTooOldError':
              reason = 'panel_version_too_old';
              extra.found_version = e.foundVersion;
              break;
            case 'TypeNotInPanelError':
              reason = 'type_not_in_panel';
              extra.article_type = e.articleType;
              extra.available_types = e.availableTypes;
              break;
            case 'StyleNotBoundError':
              reason = e.reason ?? 'style_not_bound';
              break;
          }
        }
        missing.push({ agentKey, account, role, reason, ...extra });
      }
    }
    if (missing.length > 0) {
      opts.onEvent?.({ type: "run.blocked", missingBindings: missing });
      return { blocked: true, missingBindings: missing };
    }
  }
  // --------------------------------------------------------------------------

  // Collect project images + vault addDirs once per run so every writer agent
  // receives the same @-ref attachment list.
  const { images: projectImages, addDirs: projectAddDirs } = await collectProjectImages(pDir);

  // SP-19: build + trim a single ContextBundle per run; re-used as a prefix on
  // every writer user message so each agent sees the same project snapshot.
  let ctxBundle: ContextBundle | null = null;
  if (opts.contextBundleService) {
    try {
      ctxBundle = trimToBudget(await opts.contextBundleService.build(opts.projectId));
    } catch {
      ctxBundle = null;
    }
  }

  // SP-B.2: pull hard rules once; per-role overrides applied to bookend calls.
  const hardRules = opts.hardRulesStore ? await opts.hardRulesStore.read() : null;
  const openingWordOverride = hardRules?.word_count_overrides?.opening;
  const closingWordOverride = hardRules?.word_count_overrides?.closing;

  // Per-project run-log directory for writer artifacts (bookend only —
  // practice / stitcher / style_critic don't set this to avoid disk bloat).
  const writerRunLogDir = join(opts.projectsDir, opts.projectId, 'runs');

  const selectedRaw = await readFile(join(pDir, "mission/case-plan/selected-cases.md"), "utf-8");
  const cases = parseSelectedCases(selectedRaw);
  const missionSummary = existsSync(join(pDir, "mission/selected.md"))
    ? await readFile(join(pDir, "mission/selected.md"), "utf-8") : "";
  const productOverview = existsSync(join(pDir, "context/product-overview.md"))
    ? await readFile(join(pDir, "context/product-overview.md"), "utf-8") : "";
  const briefPath = join(pDir, "brief/brief.md");
  const briefSummary = existsSync(briefPath) ? await readFile(briefPath, "utf-8") : "";

  await opts.store.update(opts.projectId, { status: "writing_running", writer_failed_sections: [] });

  if (opts.sectionsToRun) {
    const expected = ["opening", ...cases.map((c) => `practice.${c.caseId}`), "closing"];
    const expanded = new Set(opts.sectionsToRun);
    for (const k of expected) {
      const ex = await articleStore.readSection(k as SectionKey);
      if (!ex) expanded.add(k);
    }
    opts.sectionsToRun = [...expanded];
  }

  const failed: string[] = [];
  const shouldRun = (key: string) => !opts.sectionsToRun || opts.sectionsToRun.includes(key);

  const publish = async (type: string, data: Record<string, unknown>) => {
    try { await appendEvent(pDir, { type, ...data } as any); } catch { /* ignore */ }
  };

  const toolEventBridge = (sectionKey: string) => (ev: WriterToolEvent) => {
    const { type, ...rest } = ev;
    void publish(`writer.${type}`, { ...rest, section_key: sectionKey });
  };

  const dispatchTool = (call: { command: string; args: string[] }) =>
    dispatchSkill(call, { vaultPath: opts.vaultPath, sqlitePath: opts.sqlitePath });

  const openingResolved = resolve("writer.opening", opts.writerConfig);
  const practiceResolved = resolve("writer.practice", opts.writerConfig);

  const jobs: Promise<void>[] = [];

  if (shouldRun("opening")) {
    jobs.push((async () => {
      try {
        await publish("writer.section_started", {
          section_key: "opening", agent: "writer.opening",
          cli: openingResolved.cli, model: openingResolved.model ?? null,
        });
        const refs = await loadReferenceAccountKb(opts.vaultPath, openingResolved.referenceAccounts);
        const t0 = Date.now();
        const openingStyle = resolvedStyles["writer.opening"] ?? null;
        const result: WriterRunResult = await runWriterBookend({
          role: 'opening',
          sectionKey: 'opening',
          account: openingStyle?.panel.frontmatter.account ?? '',
          articleType: project.article_type! as any,
          typeSection: openingStyle?.typeSection ?? '',
          panelFrontmatter: (openingStyle?.panel.frontmatter ?? {}) as any,
          hardRulesBlock: openingStyle?.hardRulesBlock ?? '',
          projectContextBlock: ctxBundle ? renderContextBlock(ctxBundle) : '',
          wordOverride: openingWordOverride,
          product_name: project.product_info?.name ?? undefined,
          invokeAgent: invokerFor("writer.opening", openingResolved.cli, openingResolved.model, writerRunLogDir),
          userMessage: buildOpeningUserMessage(briefSummary, missionSummary, productOverview, refs),
          images: projectImages,
          addDirs: projectAddDirs,
          ...(openingStyle ? { pinnedContext: formatStyleReference(openingStyle) } : {}),
          dispatchTool,
          onEvent: toolEventBridge("opening"),
          maxRounds: 5,
        });
        await articleStore.writeSection("opening", {
          key: "opening",
          frontmatter: {
            section: "opening", last_agent: "writer.opening",
            last_updated_at: new Date().toISOString(),
            reference_accounts: openingResolved.referenceAccounts,
            cli: openingResolved.cli, model: openingResolved.model,
            ...(result.toolsUsed.length > 0 ? { tools_used: result.toolsUsed as unknown as ToolUsage[] } : {}),
          } as any,
          body: result.finalText,
        });
        await publish("writer.section_completed", {
          section_key: "opening", agent: "writer.opening",
          duration_ms: Date.now() - t0, chars: result.finalText.length,
        });
      } catch (err) {
        failed.push("opening");
        await publish("writer.section_failed", {
          section_key: "opening", agent: "writer.opening",
          error: (err as Error).message,
        });
      }
    })());
  }

  for (const c of cases) {
    const sectionKey = `practice.${c.caseId}` as SectionKey;
    if (!shouldRun(sectionKey)) continue;
    jobs.push((async () => {
      try {
        await publish("writer.section_started", {
          section_key: sectionKey, agent: "writer.practice",
          cli: practiceResolved.cli, model: practiceResolved.model ?? null,
        });
        const refs = await loadReferenceAccountKb(opts.vaultPath, practiceResolved.referenceAccounts);
        const notesPath = join(pDir, "evidence", c.caseId, "notes.md");
        let notesFm: Record<string, unknown> = {};
        let notesBody = "";
        if (existsSync(notesPath)) {
          const raw = await readFile(notesPath, "utf-8");
          const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
          if (m) {
            notesFm = (yaml.load(m[1]!) as Record<string, unknown>) ?? {};
            notesBody = m[2]!;
          } else {
            notesBody = raw;
          }
        }
        const shotsDir = join(pDir, "evidence", c.caseId, "screenshots");
        const shots: string[] = existsSync(shotsDir)
          ? (await readdir(shotsDir)).map((f) => join(shotsDir, f))
          : [];
        const t0 = Date.now();
        const practiceStyle = resolvedStyles["writer.practice"];
        const result: WriterRunResult = await runWriterPractice({
          invokeAgent: invokerFor("writer.practice", practiceResolved.cli, practiceResolved.model),
          userMessage: prependContextBlock(
            buildPracticeUserMessage(c, notesFm, notesBody, shots, refs),
            ctxBundle,
          ),
          images: Array.from(new Set([...shots, ...projectImages])),
          addDirs: projectAddDirs,
          dispatchTool,
          onEvent: toolEventBridge(sectionKey),
          sectionKey,
          ...(practiceStyle
            ? { pinnedContext: formatStyleReference(practiceStyle) }
            : {}),
        });
        await articleStore.writeSection(sectionKey, {
          key: sectionKey,
          frontmatter: {
            section: sectionKey, last_agent: "writer.practice",
            last_updated_at: new Date().toISOString(),
            reference_accounts: practiceResolved.referenceAccounts,
            cli: practiceResolved.cli, model: practiceResolved.model,
            ...(result.toolsUsed.length > 0 ? { tools_used: result.toolsUsed as unknown as ToolUsage[] } : {}),
          } as any,
          body: result.finalText,
        });
        await publish("writer.section_completed", {
          section_key: sectionKey, agent: "writer.practice",
          duration_ms: Date.now() - t0, chars: result.finalText.length,
        });
      } catch (err) {
        failed.push(sectionKey);
        await publish("writer.section_failed", {
          section_key: sectionKey, agent: "writer.practice",
          error: (err as Error).message,
        });
      }
    })());
  }

  await Promise.all(jobs);

  if (failed.length > 0) {
    await opts.store.update(opts.projectId, { status: "writing_failed", writer_failed_sections: failed });
    throw new Error(`writer stage1 failed: ${failed.join(",")}`);
  }

  // Stage 2: stitcher (still via class — no tool use)
  const stitcherResolved = resolve("practice.stitcher", opts.writerConfig);
  const practiceTexts = await Promise.all(
    cases.map(async (c) => ({
      caseId: c.caseId,
      text: (await articleStore.readSection(`practice.${c.caseId}` as SectionKey))?.body ?? "",
    })),
  );
  let transitions: Record<string, string> = {};

  const retryScoped = opts.sectionsToRun
    && !opts.sectionsToRun.some((k) => k === "transitions" || k.startsWith("practice."));

  if (retryScoped) {
    const existing = await articleStore.readSection("transitions");
    if (existing) {
      const re = /##\s+transition\.([a-z0-9-]+)\s*\n([\s\S]*?)(?=(\n##\s+transition\.)|$)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(existing.body))) transitions[m[1]!] = m[2]!.trim();
    }
  } else {
    const stitcherInput = practiceTexts.map((p) => {
      const { first, last } = firstLast(p.text);
      return { caseId: p.caseId, firstLines: first, lastLines: last };
    });
    try {
      await publish("writer.section_started", {
        section_key: "transitions", agent: "practice.stitcher",
        cli: stitcherResolved.cli, model: stitcherResolved.model ?? null,
      });
      const stitcher = new PracticeStitcherAgent({ cli: stitcherResolved.cli, model: stitcherResolved.model });
      const t0 = Date.now();
      const sOut = await stitcher.stitch({ cases: stitcherInput });
      transitions = sOut.transitions;
      const body = Object.entries(transitions)
        .map(([k, v]) => `## transition.${k}\n${v}`)
        .join("\n\n");
      await articleStore.writeSection("transitions", {
        key: "transitions",
        frontmatter: {
          section: "transitions", last_agent: "practice.stitcher",
          last_updated_at: new Date().toISOString(),
          cli: stitcherResolved.cli, model: stitcherResolved.model,
        },
        body: body || "(无过渡)",
      });
      await publish("writer.section_completed", {
        section_key: "transitions", agent: "practice.stitcher",
        duration_ms: Date.now() - t0, chars: body.length,
      });
    } catch (err) {
      failed.push("transitions");
      await publish("writer.section_failed", {
        section_key: "transitions", agent: "practice.stitcher",
        error: (err as Error).message,
      });
      await opts.store.update(opts.projectId, { status: "writing_failed", writer_failed_sections: failed });
      throw err;
    }
  }

  // Stage 3: closing
  const closingResolved = resolve("writer.closing", opts.writerConfig);
  const openingBody = (await articleStore.readSection("opening"))?.body ?? "";
  const stitchedPractice = practiceTexts
    .map((p, i) => {
      if (i === 0) return p.text;
      const prev = practiceTexts[i - 1]!.caseId;
      const trKey = `${prev}-to-${p.caseId}`;
      const tr = transitions[trKey] ? `\n${transitions[trKey]}\n` : "\n";
      return tr + p.text;
    })
    .join("\n\n");

  if (shouldRun("closing")) {
    try {
      await publish("writer.section_started", {
        section_key: "closing", agent: "writer.closing",
        cli: closingResolved.cli, model: closingResolved.model ?? null,
      });
      const refs = await loadReferenceAccountKb(opts.vaultPath, closingResolved.referenceAccounts);
      const t0 = Date.now();
      const closingStyle = resolvedStyles["writer.closing"] ?? null;
      const result: WriterRunResult = await runWriterBookend({
        role: 'closing',
        sectionKey: 'closing',
        account: closingStyle?.panel.frontmatter.account ?? '',
        articleType: project.article_type! as any,
        typeSection: closingStyle?.typeSection ?? '',
        panelFrontmatter: (closingStyle?.panel.frontmatter ?? {}) as any,
        hardRulesBlock: closingStyle?.hardRulesBlock ?? '',
        projectContextBlock: ctxBundle ? renderContextBlock(ctxBundle) : '',
        wordOverride: closingWordOverride,
        product_name: project.product_info?.name ?? undefined,
        invokeAgent: invokerFor("writer.closing", closingResolved.cli, closingResolved.model, writerRunLogDir),
        userMessage: buildClosingUserMessage(openingBody, stitchedPractice, refs),
        images: projectImages,
        addDirs: projectAddDirs,
        ...(closingStyle ? { pinnedContext: formatStyleReference(closingStyle) } : {}),
        dispatchTool,
        onEvent: toolEventBridge("closing"),
        maxRounds: 5,
      });
      await articleStore.writeSection("closing", {
        key: "closing",
        frontmatter: {
          section: "closing", last_agent: "writer.closing",
          last_updated_at: new Date().toISOString(),
          reference_accounts: closingResolved.referenceAccounts,
          cli: closingResolved.cli, model: closingResolved.model,
          ...(result.toolsUsed.length > 0 ? { tools_used: result.toolsUsed as unknown as ToolUsage[] } : {}),
        } as any,
        body: result.finalText,
      });
      await publish("writer.section_completed", {
        section_key: "closing", agent: "writer.closing",
        duration_ms: Date.now() - t0, chars: result.finalText.length,
      });
    } catch (err) {
      failed.push("closing");
      await publish("writer.section_failed", {
        section_key: "closing", agent: "writer.closing",
        error: (err as Error).message,
      });
      await opts.store.update(opts.projectId, { status: "writing_failed", writer_failed_sections: failed });
      throw err;
    }
  }

  // Stage 4: style critic — non-fatal, via runner
  const criticResolved = resolve("style_critic", opts.writerConfig);
  try {
    const sectionKeys = ["opening", ...cases.map((c) => `practice.${c.caseId}`), "closing"];
    const fullArticle = await articleStore.mergeFinal();
    const refs = await loadReferenceAccountKb(opts.vaultPath, criticResolved.referenceAccounts);
    const result: WriterRunResult = await runStyleCritic({
      invokeAgent: invokerFor("style_critic", criticResolved.cli, criticResolved.model),
      userMessage: prependContextBlock(
        buildCriticUserMessage(fullArticle, sectionKeys, refs),
        ctxBundle,
      ),
      images: projectImages,
      addDirs: projectAddDirs,
      dispatchTool,
      onEvent: toolEventBridge("style_critic"),
      sectionKey: "style_critic",
    });
    const rewrites = parseCriticRewrites(result.finalText, sectionKeys);
    const changed: string[] = [];
    for (const [key, newBody] of Object.entries(rewrites)) {
      const current = await articleStore.readSection(key as SectionKey);
      if (!current) continue;
      await articleStore.writeSection(key as SectionKey, {
        key: current.key,
        frontmatter: {
          ...current.frontmatter,
          last_agent: "style_critic",
          last_updated_at: new Date().toISOString(),
        },
        body: newBody,
      });
      changed.push(key);
    }
    await publish("writer.style_critic_applied", { sections_changed: changed });
  } catch (err) {
    await publish("writer.section_failed", {
      section_key: "style_critic", agent: "style_critic",
      error: (err as Error).message,
    });
  }

  await articleStore.rebuildFinal();
  await publish("writer.final_rebuilt", { at: new Date().toISOString() });
  await opts.store.update(opts.projectId, { status: "writing_ready", writer_failed_sections: [] });
}

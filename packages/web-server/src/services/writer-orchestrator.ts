import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  WriterOpeningAgent, WriterPracticeAgent, PracticeStitcherAgent,
  WriterClosingAgent, StyleCriticAgent,
  type ReferenceAccountKb,
} from "@crossing/agents";
import yaml from "js-yaml";
import type { ProjectStore } from "./project-store.js";
import { appendEvent } from "./event-log.js";
import { ArticleStore, type SectionKey } from "./article-store.js";

export type WriterAgentKey =
  | "writer.opening" | "writer.practice" | "writer.closing"
  | "practice.stitcher" | "style_critic";

export interface WriterConfig {
  cli_model_per_agent: Partial<Record<WriterAgentKey, { cli: "claude" | "codex"; model?: string }>>;
  reference_accounts_per_agent: Partial<Record<WriterAgentKey, string[]>>;
}

export interface RunWriterOpts {
  projectId: string;
  projectsDir: string;
  store: ProjectStore;
  vaultPath: string;
  sqlitePath: string;
  writerConfig: WriterConfig;
  sectionsToRun?: string[];
}

interface ParsedCase {
  caseId: string;
  name: string;
  description: string;
}

function parseSelectedCases(md: string): ParsedCase[] {
  // Strip frontmatter if present
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

export async function runWriter(opts: RunWriterOpts): Promise<void> {
  const pDir = join(opts.projectsDir, opts.projectId);
  const articleStore = new ArticleStore(pDir);
  await articleStore.init();

  const selectedRaw = await readFile(join(pDir, "mission/case-plan/selected-cases.md"), "utf-8");
  const cases = parseSelectedCases(selectedRaw);
  const missionSummary = existsSync(join(pDir, "mission/selected.md"))
    ? await readFile(join(pDir, "mission/selected.md"), "utf-8") : "";
  const productOverview = existsSync(join(pDir, "context/product-overview.md"))
    ? await readFile(join(pDir, "context/product-overview.md"), "utf-8") : "";
  const briefPath = join(pDir, "brief/brief.md");
  const briefSummary = existsSync(briefPath) ? await readFile(briefPath, "utf-8") : "";

  await opts.store.update(opts.projectId, { status: "writing_running", writer_failed_sections: [] });

  // Auto-expand sectionsToRun: include any expected section missing from disk.
  // This ensures retry-failed covers sections that were never attempted (e.g. closing skipped because upstream failed).
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
        const agent = new WriterOpeningAgent({ cli: openingResolved.cli, model: openingResolved.model });
        const t0 = Date.now();
        const out = await agent.write({ briefSummary, missionSummary, productOverview, referenceAccountsKb: refs });
        await articleStore.writeSection("opening", {
          key: "opening",
          frontmatter: {
            section: "opening", last_agent: "writer.opening",
            last_updated_at: new Date().toISOString(),
            reference_accounts: openingResolved.referenceAccounts,
            cli: openingResolved.cli, model: openingResolved.model,
          },
          body: out.text,
        });
        await publish("writer.section_completed", {
          section_key: "opening", agent: "writer.opening",
          duration_ms: Date.now() - t0, chars: out.text.length,
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
        const agent = new WriterPracticeAgent({ cli: practiceResolved.cli, model: practiceResolved.model });
        const t0 = Date.now();
        const out = await agent.write({
          caseId: c.caseId, caseName: c.name, caseDescription: c.description,
          notesBody, notesFrontmatter: notesFm,
          screenshotPaths: shots, referenceAccountsKb: refs,
        });
        await articleStore.writeSection(sectionKey, {
          key: sectionKey,
          frontmatter: {
            section: sectionKey, last_agent: "writer.practice",
            last_updated_at: new Date().toISOString(),
            reference_accounts: practiceResolved.referenceAccounts,
            cli: practiceResolved.cli, model: practiceResolved.model,
          },
          body: out.text,
        });
        await publish("writer.section_completed", {
          section_key: sectionKey, agent: "writer.practice",
          duration_ms: Date.now() - t0, chars: out.text.length,
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

  // Stage 2: stitcher
  const stitcherResolved = resolve("practice.stitcher", opts.writerConfig);
  const practiceTexts = await Promise.all(
    cases.map(async (c) => ({
      caseId: c.caseId,
      text: (await articleStore.readSection(`practice.${c.caseId}` as SectionKey))?.body ?? "",
    })),
  );
  let transitions: Record<string, string> = {};

  // If retry scoped away from practice/transitions, reuse existing transitions.md
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
      const agent = new WriterClosingAgent({ cli: closingResolved.cli, model: closingResolved.model });
      const t0 = Date.now();
      const out = await agent.write({ openingText: openingBody, stitchedPracticeText: stitchedPractice, referenceAccountsKb: refs });
      await articleStore.writeSection("closing", {
        key: "closing",
        frontmatter: {
          section: "closing", last_agent: "writer.closing",
          last_updated_at: new Date().toISOString(),
          reference_accounts: closingResolved.referenceAccounts,
          cli: closingResolved.cli, model: closingResolved.model,
        },
        body: out.text,
      });
      await publish("writer.section_completed", {
        section_key: "closing", agent: "writer.closing",
        duration_ms: Date.now() - t0, chars: out.text.length,
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

  // Stage 4: style critic — non-fatal
  const criticResolved = resolve("style_critic", opts.writerConfig);
  try {
    const sectionKeys = ["opening", ...cases.map((c) => `practice.${c.caseId}`), "closing"];
    const fullArticle = await articleStore.mergeFinal();
    const refs = await loadReferenceAccountKb(opts.vaultPath, criticResolved.referenceAccounts);
    const critic = new StyleCriticAgent({ cli: criticResolved.cli, model: criticResolved.model });
    const out = await critic.critique({ fullArticle, sectionKeys, referenceAccountsKb: refs });
    const changed: string[] = [];
    for (const [key, newBody] of Object.entries(out.rewrites)) {
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

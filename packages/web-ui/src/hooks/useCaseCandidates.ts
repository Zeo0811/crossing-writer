import { useEffect, useState } from "react";
import { parse as parseYaml } from "yaml";
import { getCaseCandidates } from "../api/client";

export interface CaseStep {
  step: number;
  action: string;
  prep_required?: boolean;
}

export interface CasePrompt {
  purpose: string;
  text: string;
}

export interface CaseMedia {
  kind: string;
  spec?: Record<string, unknown>;
}

export interface CaseInspiredBy {
  ref_path: string;
  what_borrowed: string;
}

export interface ParsedCase {
  index: number;
  name: string;
  caseId?: string;
  proposedBy: string[];
  creativityScore?: number;
  whyItMatters?: string;
  supportsClaims: string[];
  steps: CaseStep[];
  prompts: CasePrompt[];
  expectedMedia: CaseMedia[];
  observationPoints: string[];
  screenshotPoints: string[];
  recordingPoints: string[];
  risks: string[];
  predictedOutcome?: string;
  inspiredBy: CaseInspiredBy[];
  /** Prose commentary that follows the yaml block (under "# 详细说明") */
  narrative: string;
  /** Whole raw block for debug / fallback */
  rawBlock: string;
}

function asArray<T>(x: unknown): T[] {
  if (x == null) return [];
  if (Array.isArray(x)) return x as T[];
  return [x as T];
}

function asString(x: unknown): string {
  if (x == null) return "";
  return String(x).trim();
}

function parseCandidates(md: string): ParsedCase[] {
  // Each case is: "# Case NN — name\n\n```yaml\n...\n```\n\n# 详细说明\n<prose>\n"
  // Use explicit "\n# Case \d+" as the next-case boundary (end of string fallback) —
  // a bare $ with /m flag matches any line end and makes the non-greedy body capture 0 chars.
  const re = /# Case (\d+)[^\n]*\n([\s\S]*?)(?=\n# Case \d+\b|$(?![\r\n]))/g;
  const out: ParsedCase[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const idx = parseInt(m[1]!, 10);
    const block = m[0]!;
    const headerMatch = block.match(/^# Case \d+\s*—?\s*(.+)$/m);
    const name = headerMatch?.[1]?.trim() ?? "";

    // Extract the first ```yaml ... ``` block inside this case
    const yamlMatch = block.match(/```yaml\s*\n([\s\S]*?)```/);
    let yamlData: any = {};
    if (yamlMatch) {
      try {
        const raw = yamlMatch[1]!;
        // The yaml has its own outer "---" frontmatter markers; strip them
        let cleaned = raw.replace(/^---\s*$/m, "").replace(/^---\s*$/gm, "").trim();
        // LLM 生成的 YAML 常见问题：list item 用了 "quoted-prefix"unquoted-suffix 混合格式。
        // 例：- "新建一个任务"是否正确 → 严格 YAML 不合法。
        // 修复思路：在 "- " 开头的行里，如果整行有 1 对以上非成对引号，就把所有内部 " 去掉，
        // 然后给整个 value 加一对引号（并转义内部的冒号）。
        const fixMixed = (_m: string, pre: string, q: string, rest: string) => {
          const merged = (q + rest).replace(/"/g, "").replace(/:/g, "：");
          return `${pre}"${merged}"`;
        };
        // list-item 格式：- "xxx"yyy
        cleaned = cleaned.replace(/^(\s*-\s*)"([^"]*?)"([^\n]+)$/gm, fixMixed);
        // key: value 格式：key: "xxx"yyy
        cleaned = cleaned.replace(/^(\s*[\w_]+:\s*)"([^"]*?)"([^\n]+)$/gm, fixMixed);
        yamlData = parseYaml(cleaned) ?? {};
      } catch { yamlData = {}; }
    }

    // Prose after the yaml block (everything after the closing ``` up to next case / EOF)
    let narrative = "";
    if (yamlMatch) {
      const idxInBlock = block.indexOf(yamlMatch[0]!) + yamlMatch[0]!.length;
      narrative = block.slice(idxInBlock).replace(/^\s*#[^\n]*\n/, "").trim();
    }

    out.push({
      index: idx,
      name,
      caseId: asString(yamlData.case_id) || undefined,
      proposedBy: asArray<string>(yamlData.proposed_by).map(asString).filter(Boolean),
      creativityScore: typeof yamlData.creativity_score === "number" ? yamlData.creativity_score : undefined,
      whyItMatters: yamlData.why_it_matters ? asString(yamlData.why_it_matters) : undefined,
      supportsClaims: asArray<string>(yamlData.supports_claims).map(asString).filter(Boolean),
      steps: asArray<any>(yamlData.steps).map((s) => ({
        step: Number(s?.step ?? 0),
        action: asString(s?.action),
        prep_required: Boolean(s?.prep_required),
      })).filter((s) => s.action),
      prompts: asArray<any>(yamlData.prompts).map((p) => ({
        purpose: asString(p?.purpose),
        text: asString(p?.text),
      })).filter((p) => p.text),
      expectedMedia: asArray<any>(yamlData.expected_media).map((em) => ({
        kind: asString(em?.kind),
        spec: em?.spec ?? undefined,
      })).filter((em) => em.kind),
      observationPoints: asArray<string>(yamlData.observation_points).map(asString).filter(Boolean),
      screenshotPoints: asArray<string>(yamlData.screenshot_points).map(asString).filter(Boolean),
      recordingPoints: asArray<string>(yamlData.recording_points).map(asString).filter(Boolean),
      risks: asArray<string>(yamlData.risks).map(asString).filter(Boolean),
      predictedOutcome: yamlData.predicted_outcome ? asString(yamlData.predicted_outcome) : undefined,
      inspiredBy: asArray<any>(yamlData.inspired_by).map((ib) => ({
        ref_path: asString(ib?.ref_path),
        what_borrowed: asString(ib?.what_borrowed),
      })).filter((ib) => ib.ref_path || ib.what_borrowed),
      narrative,
      rawBlock: block,
    });
  }
  return out;
}

export function useCaseCandidates(projectId: string) {
  const [cases, setCases] = useState<ParsedCase[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    getCaseCandidates(projectId).then((md) => {
      setCases(md ? parseCandidates(md) : []);
      setLoading(false);
    });
  }, [projectId]);
  return { cases, loading };
}

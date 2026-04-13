import { useEffect, useState } from "react";
import { getCaseCandidates } from "../api/client";

export interface ParsedCase {
  index: number;
  name: string;
  proposed_by?: string;
  creativity_score?: string;
  why_it_matters?: string;
  rawBlock: string;
}

function parseCandidates(md: string): ParsedCase[] {
  const re = /# Case (\d+)[^\n]*\n([\s\S]*?)(?=^# Case \d+|$)/gm;
  const out: ParsedCase[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const idx = parseInt(m[1]!, 10);
    const block = m[0]!;
    const nameMatch = block.match(/# Case \d+\s*—?\s*(.+)/);
    const propMatch = block.match(/proposed_by:\s*(.+)/);
    const creatMatch = block.match(/creativity_score:\s*(.+)/);
    const whyMatch = block.match(/why_it_matters:\s*"?([^"\n]+)"?/);
    out.push({
      index: idx,
      name: (nameMatch?.[1] ?? "").trim(),
      proposed_by: propMatch?.[1]?.trim(),
      creativity_score: creatMatch?.[1]?.trim(),
      why_it_matters: whyMatch?.[1]?.trim(),
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

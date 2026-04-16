import { useState } from "react";
import type { FileInfo } from "../../api/evidence-client";
import { ActionButton } from "../ui/ActionButton";

interface Observation {
  point: string;
  severity: "major" | "minor" | "positive";
  screenshot_ref?: string;
  generated_ref?: string;
}

interface Quantitative {
  rework_count?: number;
  total_steps?: number;
  completed_steps?: number;
  avg_step_time_min?: number;
  total_tokens?: number;
}

interface Frontmatter {
  type: "evidence_notes";
  case_id: string;
  ran_at?: string;
  duration_min?: number;
  quantitative?: Quantitative;
  observations?: Observation[];
}

interface Props {
  caseId: string;
  notes: { frontmatter: Record<string, any>; body: string } | null;
  screenshotFiles: FileInfo[];
  generatedFiles: FileInfo[];
  onSave: (data: { frontmatter: Frontmatter; body: string }) => Promise<void>;
}

function initFrontmatter(caseId: string, fm: Record<string, any> | undefined): Frontmatter {
  return {
    type: "evidence_notes",
    case_id: caseId,
    ran_at: fm?.ran_at,
    duration_min: fm?.duration_min,
    quantitative: fm?.quantitative ?? {},
    observations: fm?.observations ?? [],
  };
}

export function NotesEditor({ caseId, notes, screenshotFiles, generatedFiles, onSave }: Props) {
  const [fm, setFm] = useState<Frontmatter>(() => initFrontmatter(caseId, notes?.frontmatter));
  const [body, setBody] = useState(notes?.body ?? "");

  function setQ(k: keyof Quantitative, v: string) {
    const num = v === "" ? undefined : Number(v);
    setFm({
      ...fm,
      quantitative: { ...(fm.quantitative ?? {}), [k]: num },
    });
  }

  function addObs() {
    setFm({
      ...fm,
      observations: [...(fm.observations ?? []), { point: "", severity: "minor" }],
    });
  }

  function updateObs(i: number, patch: Partial<Observation>) {
    const next = [...(fm.observations ?? [])];
    next[i] = { ...next[i]!, ...patch };
    setFm({ ...fm, observations: next });
  }

  function removeObs(i: number) {
    const next = [...(fm.observations ?? [])];
    next.splice(i, 1);
    setFm({ ...fm, observations: next });
  }

  async function save() {
    const q: Quantitative = {};
    for (const [k, v] of Object.entries(fm.quantitative ?? {})) {
      if (typeof v === "number" && !isNaN(v)) q[k as keyof Quantitative] = v;
    }
    const cleanFm: Frontmatter = {
      type: "evidence_notes",
      case_id: caseId,
      ...(fm.ran_at ? { ran_at: fm.ran_at } : {}),
      ...(typeof fm.duration_min === "number" ? { duration_min: fm.duration_min } : {}),
      ...(Object.keys(q).length > 0 ? { quantitative: q } : {}),
      ...(fm.observations && fm.observations.length > 0
        ? { observations: fm.observations.filter((o) => o.point.trim()) }
        : {}),
    };
    await onSave({ frontmatter: cleanFm, body });
  }

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold">📝 观察笔记</h4>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <label>
          ran_at:
          <input
            type="datetime-local"
            className="w-full border p-1"
            value={fm.ran_at ?? ""}
            onChange={(e) => setFm({ ...fm, ran_at: e.target.value })}
          />
        </label>
        <label>
          duration_min:
          <input
            type="number"
            className="w-full border p-1"
            value={fm.duration_min ?? ""}
            onChange={(e) => setFm({ ...fm, duration_min: e.target.value === "" ? undefined : Number(e.target.value) })}
          />
        </label>
        <label>
          rework_count:
          <input type="number" className="w-full border p-1"
            value={fm.quantitative?.rework_count ?? ""}
            onChange={(e) => setQ("rework_count", e.target.value)} />
        </label>
        <label>
          total_steps:
          <input type="number" className="w-full border p-1"
            value={fm.quantitative?.total_steps ?? ""}
            onChange={(e) => setQ("total_steps", e.target.value)} />
        </label>
        <label>
          completed_steps:
          <input type="number" className="w-full border p-1"
            value={fm.quantitative?.completed_steps ?? ""}
            onChange={(e) => setQ("completed_steps", e.target.value)} />
        </label>
        <label>
          avg_step_time_min:
          <input type="number" className="w-full border p-1"
            value={fm.quantitative?.avg_step_time_min ?? ""}
            onChange={(e) => setQ("avg_step_time_min", e.target.value)} />
        </label>
      </div>

      <div>
        <h5 className="text-xs font-semibold">Observations</h5>
        <ul className="space-y-2">
          {(fm.observations ?? []).map((obs, i) => (
            <li key={i} className="border p-2 rounded space-y-1">
              <input
                placeholder="observation 内容"
                className="w-full border p-1 text-xs"
                value={obs.point}
                onChange={(e) => updateObs(i, { point: e.target.value })}
              />
              <div className="flex gap-1 text-xs">
                <select
                  className="border p-1"
                  value={obs.severity}
                  onChange={(e) => updateObs(i, { severity: e.target.value as Observation["severity"] })}
                >
                  <option value="major">major</option>
                  <option value="minor">minor</option>
                  <option value="positive">positive</option>
                </select>
                <select
                  className="border p-1 flex-1"
                  value={obs.screenshot_ref ?? ""}
                  onChange={(e) => updateObs(i, { screenshot_ref: e.target.value || undefined })}
                >
                  <option value="">关联截图(无)</option>
                  {screenshotFiles.map((f) => (
                    <option key={f.filename} value={`screenshots/${f.filename}`}>{f.filename}</option>
                  ))}
                </select>
                <select
                  className="border p-1 flex-1"
                  value={obs.generated_ref ?? ""}
                  onChange={(e) => updateObs(i, { generated_ref: e.target.value || undefined })}
                >
                  <option value="">关联产出(无)</option>
                  {generatedFiles.map((f) => (
                    <option key={f.filename} value={`generated/${f.filename}`}>{f.filename}</option>
                  ))}
                </select>
                <button onClick={() => removeObs(i)} className="text-[var(--red)]" aria-label={`remove obs ${i}`}>
                  删
                </button>
              </div>
            </li>
          ))}
        </ul>
        <button onClick={addObs} className="text-xs text-[var(--accent)] mt-1">+ 添加 observation</button>
      </div>

      <div>
        <h5 className="text-xs font-semibold">自由笔记</h5>
        <textarea
          className="w-full border p-2 text-xs font-mono"
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </div>

      <ActionButton
        onClick={save}
        successMsg="笔记已保存"
        errorMsg={(e) => `保存失败：${String(e)}`}
      >
        保存笔记
      </ActionButton>
    </div>
  );
}

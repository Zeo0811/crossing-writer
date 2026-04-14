import { useEffect, useRef, useState } from "react";
import { startDistillStream, type DistillBody } from "../../api/style-panels-client.js";

export interface ProgressViewProps {
  account: string;
  body: DistillBody;
  onDone: () => void;
}

const STEP_LABEL: Record<string, string> = {
  quant: "[1/4] quant-analyzer",
  structure: "[2/4] structure-distiller",
  snippets: "[3/4] snippet-harvester",
  composer: "[4/4] composer",
};

export function ProgressView({ account, body, onDone }: ProgressViewProps) {
  const [lines, setLines] = useState<string[]>([]);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        await startDistillStream(account, body, (ev) => {
          if (ev.type === "distill.step_started") {
            setLines((xs) => [...xs, STEP_LABEL[ev.data.step] ?? ev.data.step, "  → running..."]);
          } else if (ev.type === "distill.batch_progress") {
            setLines((xs) => [...xs, `  → batch ${ev.data.batch}/${ev.data.total_batches}: ${ev.data.candidates_so_far} candidates`]);
          } else if (ev.type === "distill.step_completed") {
            const stats = ev.data.stats ?? {};
            const parts = Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(" ");
            setLines((xs) => [...xs, `  → done (${Math.round((ev.data.duration_ms ?? 0) / 1000)}s) ${parts}`]);
          } else if (ev.type === "distill.step_failed") {
            setLines((xs) => [...xs, `  → FAILED: ${ev.data.error}`]);
          } else if (ev.type === "distill.all_completed") {
            setLines((xs) => [...xs, `Done: ${ev.data.kb_path}`]);
            onDone();
          }
        });
      } catch (e) {
        setLines((xs) => [...xs, `ERROR: ${(e as Error).message}`]);
      }
    })();
  }, [account, body, onDone]);

  return (
    <div className="border rounded p-4 space-y-3 bg-white">
      <h2 className="text-lg font-semibold">蒸馏 {account}</h2>
      <pre className="bg-gray-900 text-green-300 text-xs p-3 rounded overflow-auto max-h-[60vh] whitespace-pre-wrap">{lines.join("\n") || "等待开始…"}</pre>
    </div>
  );
}

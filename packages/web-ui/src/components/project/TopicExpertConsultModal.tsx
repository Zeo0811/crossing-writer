import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listTopicExperts,
  consultTopicExperts,
  type TopicExpertMeta,
  type TopicExpertInvokeType,
} from "../../api/writer-client";
import {
  initialTopicConsultState,
  reduceTopicConsult,
  type TopicConsultState,
} from "../../hooks/useProjectStream";
import { ExpertStreamCard } from "./ExpertStreamCard";

interface Props {
  projectId: string;
  briefSummary?: string;
  productContext?: string;
  candidatesMd?: string;
  currentDraft?: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (markdown: string) => void;
  // injection for tests
  api?: {
    list: typeof listTopicExperts;
    consult: typeof consultTopicExperts;
  };
}

export function TopicExpertConsultModal(props: Props) {
  const {
    projectId,
    briefSummary,
    productContext,
    candidatesMd,
    currentDraft,
    open,
    onClose,
    onSaved,
  } = props;
  const listApi = props.api?.list ?? listTopicExperts;
  const consultApi = props.api?.consult ?? consultTopicExperts;

  const [experts, setExperts] = useState<TopicExpertMeta[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [invokeType, setInvokeType] = useState<TopicExpertInvokeType>("score");
  const [state, setState] = useState<TopicConsultState>(initialTopicConsultState());

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { experts } = await listApi();
      const active = experts.filter((e) => e.active && !e.soft_deleted);
      setExperts(active);
      setSelected(new Set(active.filter((e) => e.default_preselect).map((e) => e.name)));
    })();
  }, [open, listApi]);

  const toggle = (name: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });
  };

  const startOne = useCallback((names: string[]) => {
    consultApi(
      projectId,
      {
        selected: names,
        invokeType,
        brief: briefSummary,
        productContext,
        candidatesMd,
        currentDraft,
      },
      {
        onEvent: (type, data) => {
          setState((prev) => reduceTopicConsult(prev, { type, data: (data as any) ?? {} }));
        },
      },
    );
  }, [consultApi, projectId, invokeType, briefSummary, productContext, candidatesMd, currentDraft]);

  const start = () => {
    setState(initialTopicConsultState());
    startOne([...selected]);
  };

  const retry = (name: string) => {
    startOne([name]);
  };

  const combined = useMemo(() => {
    return state.succeeded
      .map((n) => `## ${n}\n\n${state.experts[n]?.markdown ?? ""}`)
      .join("\n\n");
  }, [state]);

  const done = Object.values(state.experts).filter((e) => e.status === "done" || e.status === "failed").length;
  const total = Object.keys(state.experts).length;

  if (!open) return null;
  return (
    <div role="dialog" aria-label="选题专家团咨询" data-testid="consult-modal" data-modal-root="" className="bg-bg-1 text-body">
      {state.status === "idle" ? (
        <>
          <div role="radiogroup" aria-label="invokeType">
            {(["score", "structure", "continue"] as const).map((t) => (
              <label key={t}>
                <input
                  type="radio"
                  name="invokeType"
                  value={t}
                  checked={invokeType === t}
                  onChange={() => setInvokeType(t)}
                  aria-label={`invokeType-${t}`}
                />
                {t === "score" ? "打分" : t === "structure" ? "结构" : "续写"}
              </label>
            ))}
          </div>
          <ul>
            {experts.map((e) => (
              <li key={e.name}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`select-${e.name}`}
                    checked={selected.has(e.name)}
                    onChange={() => toggle(e.name)}
                  />
                  {e.name} — {e.specialty}
                </label>
              </li>
            ))}
          </ul>
          <button onClick={onClose}>取消</button>
          <button
            onClick={start}
            disabled={selected.size === 0}
            data-testid="consult-start"
          >
            开始召唤
          </button>
        </>
      ) : (
        <>
          <div data-testid="consult-progress">{done} / {total} 专家已完成</div>
          <div>
            {Object.entries(state.experts).map(([name, s]) => (
              <ExpertStreamCard
                key={name}
                name={name}
                status={s.status}
                markdown={s.markdown}
                error={s.error}
                onRetry={s.status === "failed" ? () => retry(name) : undefined}
              />
            ))}
          </div>
          {state.status === "done" && (
            <button
              onClick={() => onSaved?.(combined)}
              data-testid="consult-save"
            >
              保存到项目笔记
            </button>
          )}
        </>
      )}
    </div>
  );
}

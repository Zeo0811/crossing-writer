import { useCallback, useEffect, useState } from "react";
import {
  listTopicExperts,
  setTopicExpert,
  createTopicExpert,
  deleteTopicExpert,
  distillTopicExpert,
  type TopicExpertMeta,
} from "../../api/writer-client";
import { NewTopicExpertModal } from "./NewTopicExpertModal";

interface Props {
  api?: {
    list: typeof listTopicExperts;
    set: typeof setTopicExpert;
    create: typeof createTopicExpert;
    del: typeof deleteTopicExpert;
    distill: typeof distillTopicExpert;
  };
}

export function TopicExpertPanel({ api }: Props = {}) {
  const list = api?.list ?? listTopicExperts;
  const setApi = api?.set ?? setTopicExpert;
  const createApi = api?.create ?? createTopicExpert;
  const delApi = api?.del ?? deleteTopicExpert;
  const distillApi = api?.distill ?? distillTopicExpert;

  const [experts, setExperts] = useState<TopicExpertMeta[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [distillLog, setDistillLog] = useState<Record<string, string[]>>({});

  const refresh = useCallback(async () => {
    setErr(null);
    try {
      const { experts } = await list();
      setExperts(experts);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }, [list]);

  useEffect(() => { refresh(); }, [refresh]);

  const onToggle = async (name: string, field: "active" | "default_preselect", v: boolean) => {
    setBusy((b) => ({ ...b, [name]: true }));
    try {
      await setApi(name, { [field]: v });
      await refresh();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy((b) => ({ ...b, [name]: false }));
    }
  };

  const onHardDelete = async (name: string) => {
    const typed = globalThis.prompt?.(`删除 ${name}。请输入专家名确认：`);
    if (typed !== name) return;
    await delApi(name, { mode: "hard" });
    await refresh();
  };

  const onRedistill = (name: string) => {
    setDistillLog((l) => ({ ...l, [name]: [] }));
    distillApi(name, { mode: "redistill" }, {
      onEvent: (type) => {
        setDistillLog((l) => ({ ...l, [name]: [...(l[name] ?? []), type] }));
      },
    });
  };

  const onCreated = async (body: { name: string; specialty: string; seed_urls?: string[] }) => {
    await createApi({ name: body.name, specialty: body.specialty });
    if (body.seed_urls && body.seed_urls.length) {
      distillApi(body.name, { mode: "initial", seed_urls: body.seed_urls }, {
        onEvent: (type) => {
          setDistillLog((l) => ({ ...l, [body.name]: [...(l[body.name] ?? []), type] }));
        },
      });
    }
    setModalOpen(false);
    await refresh();
  };

  if (experts === null) {
    return <div data-testid="te-loading" className="text-sm text-[var(--meta)] p-4">加载中…</div>;
  }

  return (
    <div data-testid="te-panel" className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-xs text-[var(--meta)]">共 {experts.length} 位</div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          data-testid="te-new-btn"
          className="px-3 py-1.5 text-xs rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold hover:shadow-[0_0_12px_var(--accent-dim)]"
        >
          ＋ 新增专家
        </button>
      </div>
      {err && (
        <div role="alert" className="rounded border border-[var(--red)] bg-[rgba(255,107,107,0.05)] px-3 py-2 text-sm text-[var(--red)]">
          {err}
        </div>
      )}
      {experts.length === 0 ? (
        <div className="rounded bg-[var(--bg-2)] p-6 text-center text-[var(--meta)] text-sm">暂无专家</div>
      ) : (
        <div className="space-y-1.5">
          <div className="grid grid-cols-[140px_1fr_80px_80px_140px_140px] gap-3 px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--faint)]">
            <span>名称</span>
            <span>专长</span>
            <span>启用</span>
            <span>预选</span>
            <span>上次蒸馏</span>
            <span className="text-right">操作</span>
          </div>
          {experts.map((e) => (
            <div
              key={e.name}
              data-testid={`te-row-${e.name}`}
              className={`grid grid-cols-[140px_1fr_80px_80px_140px_140px] gap-3 items-center px-3 py-2.5 rounded bg-[var(--bg-2)] text-sm ${
                e.soft_deleted ? "opacity-50" : ""
              }`}
            >
              <div className="font-semibold text-[var(--heading)] truncate">{e.name}</div>
              <div className="text-[var(--body)] truncate">{e.specialty}</div>
              <div>
                <input
                  type="checkbox"
                  aria-label={`active-${e.name}`}
                  checked={e.active}
                  disabled={!!busy[e.name]}
                  onChange={(ev) => onToggle(e.name, "active", ev.target.checked)}
                  className="accent-[var(--accent)]"
                />
              </div>
              <div>
                <input
                  type="checkbox"
                  aria-label={`preselect-${e.name}`}
                  checked={e.default_preselect}
                  disabled={!!busy[e.name]}
                  onChange={(ev) => onToggle(e.name, "default_preselect", ev.target.checked)}
                  className="accent-[var(--accent)]"
                />
              </div>
              <div className="text-xs text-[var(--meta)] truncate">{e.distilled_at ?? "—"}</div>
              <div className="flex items-center gap-3 justify-end">
                <button
                  onClick={() => onRedistill(e.name)}
                  data-testid={`te-redistill-${e.name}`}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  重蒸
                </button>
                <button
                  onClick={() => onHardDelete(e.name)}
                  data-testid={`te-hard-${e.name}`}
                  className="text-xs text-[var(--meta)] hover:text-[var(--red)]"
                >
                  删除
                </button>
              </div>
              {distillLog[e.name] && (
                <div className="col-span-6 text-[10px] text-[var(--faint)] px-1" data-testid={`te-log-${e.name}`} style={{ fontFamily: "var(--font-mono)" }}>
                  {distillLog[e.name]!.join(" · ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {modalOpen && (
        <NewTopicExpertModal
          onClose={() => setModalOpen(false)}
          onSubmit={onCreated}
        />
      )}
    </div>
  );
}

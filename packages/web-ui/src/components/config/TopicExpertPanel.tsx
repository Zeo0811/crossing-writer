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
  // injection for tests
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

  const onSoftDelete = async (name: string) => {
    if (!globalThis.confirm?.(`软删除 ${name} ?`)) return;
    await delApi(name, { mode: "soft" });
    await refresh();
  };

  const onHardDelete = async (name: string) => {
    const typed = globalThis.prompt?.(`硬删除 ${name}。请输入专家名确认：`);
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

  const onCreated = async (
    body: { name: string; specialty: string; seed_urls?: string[] },
  ) => {
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
    return <div data-testid="te-loading">加载中...</div>;
  }
  return (
    <div data-testid="te-panel">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-heading m-0 font-pixel tracking-[0.06em] text-accent">🧑‍🎓 选题专家团</h2>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          data-testid="te-new-btn"
          className="px-3 py-1 text-xs bg-accent text-accent-on border border-accent rounded-[2px] cursor-pointer hover:bg-accent-soft hover:border-accent-soft"
        >
          + 新增专家
        </button>
      </div>
      {err && <div role="alert" className="text-red">{err}</div>}
      {experts.length === 0 ? (
        <div>暂无专家</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>名称</th><th>专长</th><th>启用</th><th>预选</th>
              <th>蒸馏时间</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {experts.map((e) => (
              <tr key={e.name} data-testid={`te-row-${e.name}`}
                  style={{ opacity: e.soft_deleted ? 0.5 : 1 }}>
                <td>{e.name}</td>
                <td>{e.specialty}</td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`active-${e.name}`}
                    checked={e.active}
                    disabled={!!busy[e.name]}
                    onChange={(ev) => onToggle(e.name, "active", ev.target.checked)}
                  />
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`preselect-${e.name}`}
                    checked={e.default_preselect}
                    disabled={!!busy[e.name]}
                    onChange={(ev) => onToggle(e.name, "default_preselect", ev.target.checked)}
                  />
                </td>
                <td>{e.distilled_at ?? "-"}</td>
                <td>
                  <button onClick={() => onRedistill(e.name)} data-testid={`te-redistill-${e.name}`}>重蒸</button>
                  <button onClick={() => onSoftDelete(e.name)} data-testid={`te-soft-${e.name}`}>软删</button>
                  <button onClick={() => onHardDelete(e.name)} data-testid={`te-hard-${e.name}`}>硬删</button>
                  {distillLog[e.name] && (
                    <span data-testid={`te-log-${e.name}`}>{distillLog[e.name]!.join(",")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

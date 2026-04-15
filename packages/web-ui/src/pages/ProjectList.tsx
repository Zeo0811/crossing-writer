import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  useProjects,
  useCreateProject,
  useArchivedProjects,
  useArchiveProject,
  useRestoreProject,
  useDestroyProject,
} from "../hooks/useProjects";
import { PixelEmptyArt } from "../components/layout/PixelIcons";
import { PHASES, phaseIndexOf, statusBadge } from "../components/layout/PhaseSteps";
import type { Project, ProjectStatus } from "../api/types";

type Tab = "active" | "archived";

function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
}

export function ProjectList() {
  const [tab, setTab] = useState<Tab>("active");
  const [q, setQ] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const { data: activeData } = useProjects();
  const { data: archivedData } = useArchivedProjects(tab === "archived");
  const create = useCreateProject();
  const archive = useArchiveProject();
  const restore = useRestoreProject();
  const destroy = useDestroyProject();
  const nav = useNavigate();

  const activeItems: Project[] = activeData?.items ?? [];
  const archivedItems: Project[] = archivedData?.items ?? [];
  const activeCount = archivedData?.active_count ?? activeItems.length;
  const archivedCount = activeData?.archived_count ?? archivedItems.length;

  const source = tab === "active" ? activeItems : archivedItems;
  const visible = useMemo(
    () => source.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())),
    [source, q],
  );

  async function handleCreate(name: string) {
    const p = await create.mutateAsync(name);
    setShowNew(false);
    nav(`/projects/${p.id}`);
  }

  return (
    <div onClick={() => setMenuId(null)}>
      <header className="flex items-center justify-end mb-[18px] pt-4">
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] text-sm font-semibold hover:shadow-[0_0_12px_var(--accent-dim)] transition-shadow"
        >
          <span>＋</span><span>新建项目</span>
        </button>
      </header>

      <div className="flex items-center gap-3 mb-[18px]">
        <div className="flex items-center gap-1 p-1 rounded border border-[var(--hair)] bg-[var(--bg-1)]">
          <TabBtn active={tab === "active"} onClick={() => setTab("active")}>
            进行中 <span className="ml-1 text-[var(--faint)] text-xs">{activeCount}</span>
          </TabBtn>
          <TabBtn active={tab === "archived"} onClick={() => setTab("archived")}>
            归档 <span className="ml-1 text-[var(--faint)] text-xs">{archivedCount}</span>
          </TabBtn>
        </div>
        <div className="flex-1 relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索项目名…"
            className="w-full bg-[var(--bg-1)] border border-[var(--hair)] rounded px-3 py-2 pl-9 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--faint)] leading-none pointer-events-none">⌕</span>
          {q && <button onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--faint)] hover:text-[var(--heading)] text-xs">✕</button>}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState tab={tab} q={q} onNew={() => setShowNew(true)} onClear={() => setQ("")} />
      ) : (
        <div className="grid grid-cols-2 gap-[18px]">
          {visible.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              archived={tab === "archived"}
              menuOpen={menuId === p.id}
              onMenuToggle={(e) => { e.stopPropagation(); setMenuId(menuId === p.id ? null : p.id); }}
              onOpen={() => nav(`/projects/${p.id}`)}
              onArchive={async () => { setMenuId(null); await archive.mutateAsync(p.id); }}
              onRestore={async () => { setMenuId(null); await restore.mutateAsync(p.id); }}
              onDelete={() => { setMenuId(null); setDeleteTarget(p); }}
            />
          ))}
        </div>
      )}

      {showNew && <NewProjectModal busy={create.isPending} onClose={() => setShowNew(false)} onCreate={handleCreate} />}
      {deleteTarget && (
        <DeleteModal
          project={deleteTarget}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await destroy.mutateAsync({ id: deleteTarget.id, confirm: deleteTarget.name });
            setDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-xs ${
        active ? "bg-[var(--accent-fill)] text-[var(--accent)] border border-[var(--accent-soft)]" : "text-[var(--meta)] hover:text-[var(--heading)] border border-transparent"
      }`}
    >
      {children}
    </button>
  );
}

function ProjectCard({
  project: p, archived, menuOpen, onMenuToggle, onOpen, onArchive, onRestore, onDelete,
}: {
  project: Project;
  archived: boolean;
  menuOpen: boolean;
  onMenuToggle: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const tone = statusBadge(p.status);
  const phase = phaseIndexOf(p.status as ProjectStatus);
  const updated = p.brief?.uploaded_at ?? null;
  return (
    <article
      onClick={onOpen}
      className={`group relative rounded border ${archived ? "border-[var(--hair)] opacity-65" : "border-[var(--hair)] hover:border-[var(--accent-soft)]"} bg-[var(--bg-1)] p-[18px] cursor-pointer transition-all hover:shadow-[0_4px_20px_rgba(0,0,0,0.25)]`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[var(--heading)] font-semibold truncate mb-0.5">{p.name}</h3>
          <div className="text-xs text-[var(--meta)]">
            {p.product_info?.name ?? "—"} · {timeAgo(updated)}
          </div>
        </div>
        <span
          className="text-[11px] px-2 py-0.5 rounded-sm whitespace-nowrap font-medium"
          style={{ color: tone.fg, background: tone.bg }}
        >
          {tone.label}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-1">
        <PhaseDots current={phase} total={PHASES.length} />
        <span className="text-[10px] text-[var(--faint)] tabular-nums">{phase + 1}/{PHASES.length}</span>
      </div>

      <button
        onClick={onMenuToggle}
        className="absolute bottom-3 right-3 w-7 h-7 flex items-center justify-center text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)] rounded transition-colors"
        aria-label="actions"
      >
        ⋯
      </button>
      {menuOpen && (
        <div
          className="absolute right-2 bottom-12 z-20 w-36 rounded border border-[var(--hair-strong)] bg-[var(--bg-1)] shadow-lg overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <MenuItem onClick={onOpen}>打开</MenuItem>
          {archived ? <MenuItem onClick={onRestore}>恢复</MenuItem> : <MenuItem onClick={onArchive}>归档</MenuItem>}
          <MenuItem onClick={onDelete} danger>删除…</MenuItem>
        </div>
      )}
    </article>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-xs ${danger ? "text-[var(--red)] hover:bg-[rgba(255,107,107,0.1)]" : "text-[var(--body)] hover:bg-[var(--bg-2)]"}`}
    >
      {children}
    </button>
  );
}

function PhaseDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-sm"
          style={{
            background: i <= current ? (i === current ? "var(--accent)" : "var(--accent-soft)") : "var(--hair-strong)",
            boxShadow: i === current ? "0 0 6px var(--accent-dim)" : "none",
          }}
        />
      ))}
    </div>
  );
}

function EmptyState({ tab, q, onNew, onClear }: { tab: Tab; q: string; onNew: () => void; onClear: () => void }) {
  if (q) {
    return (
      <div className="border border-dashed border-[var(--hair)] rounded p-16 text-center">
        <div className="text-4xl text-[var(--faint)] mb-3">⌕</div>
        <p className="text-[var(--meta)] mb-3">没有匹配「{q}」的项目</p>
        <button onClick={onClear} className="text-xs text-[var(--accent)] hover:underline">清除搜索</button>
      </div>
    );
  }
  if (tab === "archived") {
    return (
      <div className="border border-dashed border-[var(--hair)] rounded p-16 text-center">
        <PixelEmptyArt size={72} />
        <p className="text-[var(--meta)] mt-4">归档区是空的</p>
      </div>
    );
  }
  return (
    <div className="border border-dashed border-[var(--accent-soft)] rounded py-16 px-8 text-center bg-[var(--accent-fill)]/15">
      <div className="flex justify-center mb-5"><PixelEmptyArt size={108} /></div>
      <h2 className="text-xl text-[var(--heading)] font-semibold mb-2">开始你的第一个项目</h2>
      <p className="text-[var(--meta)] text-sm mb-7 max-w-[420px] mx-auto leading-relaxed">
        把甲方 brief 丢进来，AI 会帮你拆选题、规划 case、跑实测、写终稿。
      </p>
      <button
        onClick={onNew}
        className="inline-flex items-center gap-2 px-7 py-3 rounded border border-[var(--accent-soft)] bg-[var(--accent)] text-[var(--accent-on)] font-semibold text-base hover:shadow-[0_0_18px_var(--accent-dim)] transition-shadow"
      >
        <span className="text-xl leading-none">＋</span>
        <span>新建项目</span>
      </button>
    </div>
  );
}

function NewProjectModal({ busy, onClose, onCreate }: { busy?: boolean; onClose: () => void; onCreate: (name: string) => void | Promise<void> }) {
  const [name, setName] = useState("");
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(0,0,0,0.5)] backdrop-blur-sm" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-[440px] rounded border border-[var(--hair-strong)] bg-[var(--bg-1)] shadow-2xl">
        <div className="px-4 py-3 border-b border-[var(--hair)] flex items-center justify-between">
          <h3 className="text-[var(--heading)] font-semibold">新建项目</h3>
          <button onClick={onClose} className="text-[var(--meta)] hover:text-[var(--heading)]">✕</button>
        </div>
        <div className="p-4">
          <label className="block">
            <span className="text-xs text-[var(--meta)] block mb-1">项目名称</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void onCreate(name.trim()); }}
              placeholder="例：测评 Cursor IDE"
              className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm text-[var(--body)] outline-none focus:border-[var(--accent-soft)]"
            />
          </label>
        </div>
        <div className="px-4 py-3 border-t border-[var(--hair)] flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--meta)] hover:text-[var(--heading)]">取消</button>
          <button
            disabled={!name.trim() || busy}
            onClick={() => name.trim() && onCreate(name.trim())}
            className="px-4 py-1.5 text-xs rounded bg-[var(--accent)] text-[var(--accent-on)] disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
          >
            {busy ? "创建中…" : "创建并继续"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim() === project.name;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-[rgba(0,0,0,0.5)] backdrop-blur-sm" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-[440px] rounded border border-[var(--red)] bg-[var(--bg-1)] shadow-2xl">
        <div className="px-4 py-3 border-b border-[var(--hair)]">
          <h3 className="text-[var(--heading)] font-semibold">永久删除项目？</h3>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-[var(--body)]">
            这会<strong>永久删除</strong> <span className="text-[var(--red)] font-semibold">{project.name}</span> 及其所有数据。此操作不可恢复。
          </p>
          <label className="block">
            <span className="text-xs text-[var(--meta)] block mb-1">输入项目名以确认</span>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={project.name}
              className="w-full bg-[var(--bg-2)] border border-[var(--hair)] rounded px-3 py-2 text-sm text-[var(--body)] outline-none focus:border-[var(--red)]"
            />
          </label>
        </div>
        <div className="px-4 py-3 border-t border-[var(--hair)] flex items-center justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs text-[var(--meta)] hover:text-[var(--heading)]">取消</button>
          <button
            disabled={!ok}
            onClick={onConfirm}
            className="px-4 py-1.5 text-xs rounded bg-[var(--red)] text-white disabled:opacity-40 disabled:cursor-not-allowed font-semibold"
          >
            永久删除
          </button>
        </div>
      </div>
    </div>
  );
}

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
import { useToast } from "../components/ui/ToastProvider";
import { PixelEmptyArt } from "../components/layout/PixelIcons";
import { PHASES, phaseIndexOf, statusBadge } from "../components/layout/PhaseSteps";
import type { Project, ProjectStatus } from "../api/types";
import {
  Button, Input, FormField,
  Dialog, DialogContent, DialogHeader, DialogBody, DialogFooter,
  EmptyState as UiEmptyState,
} from "../components/ui";

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
  const toast = useToast();

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
        <Button variant="primary" size="sm" onClick={() => setShowNew(true)} leftSlot="＋">
          新建项目
        </Button>
      </header>

      <div className="flex items-center gap-3 mb-[18px]">
        <div className="flex items-center gap-1 p-1 h-9 rounded border border-[var(--hair)] bg-[var(--bg-1)]">
          <TabBtn active={tab === "active"} onClick={() => setTab("active")}>
            进行中 <span className="ml-1 text-[var(--faint)] text-xs">{activeCount}</span>
          </TabBtn>
          <TabBtn active={tab === "archived"} onClick={() => setTab("archived")}>
            归档 <span className="ml-1 text-[var(--faint)] text-xs">{archivedCount}</span>
          </TabBtn>
        </div>
        <div className="flex-1">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索项目名…"
            leftSlot="⌕"
            className="h-9 bg-[var(--bg-1)]"
            rightSlot={q && (
              <button onClick={() => setQ("")} className="text-[var(--faint)] hover:text-[var(--heading)] text-xs">✕</button>
            )}
          />
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
              onArchive={async () => { setMenuId(null); try { await archive.mutateAsync(p.id); toast.success("已归档"); } catch { toast.error("归档失败"); } }}
              onRestore={async () => { setMenuId(null); try { await restore.mutateAsync(p.id); toast.success("已恢复"); } catch { toast.error("恢复失败"); } }}
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
            {p.product_info?.name ? `${p.product_info.name} · ` : ""}{timeAgo(updated)}
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

      <div className="absolute bottom-3 right-3" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onMenuToggle}
          className="w-7 h-7 flex items-center justify-center text-[var(--meta)] hover:text-[var(--heading)] hover:bg-[var(--bg-2)] rounded transition-colors"
          aria-label="actions"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-0 bottom-9 z-20 w-36 rounded border border-[var(--hair-strong)] bg-[var(--bg-1)] shadow-lg overflow-hidden">
            <MenuItem onClick={onOpen}>打开</MenuItem>
            {archived ? <MenuItem onClick={onRestore}>恢复</MenuItem> : <MenuItem onClick={onArchive}>归档</MenuItem>}
            <MenuItem onClick={onDelete} danger>删除…</MenuItem>
          </div>
        )}
      </div>
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
      <UiEmptyState
        icon={<span className="text-4xl text-[var(--faint)]">⌕</span>}
        body={`没有匹配「${q}」的项目`}
        action={<Button variant="link" size="sm" onClick={onClear}>清除搜索</Button>}
      />
    );
  }
  if (tab === "archived") {
    return (
      <UiEmptyState
        icon={<PixelEmptyArt size={72} />}
        body="归档区是空的"
      />
    );
  }
  return (
    <UiEmptyState
      variant="primary"
      icon={<PixelEmptyArt size={108} />}
      title="开始你的第一个项目"
      body="把甲方 brief 丢进来，AI 会帮你拆选题、规划 case、跑实测、写终稿。"
      action={
        <Button variant="primary" size="lg" onClick={onNew} leftSlot="＋">
          新建项目
        </Button>
      }
    />
  );
}

function NewProjectModal({ busy, onClose, onCreate }: { busy?: boolean; onClose: () => void; onCreate: (name: string) => void | Promise<void> }) {
  const [name, setName] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader title="新建项目" onClose={onClose} />
        <DialogBody>
          <FormField label="项目名称">
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) void onCreate(name.trim()); }}
              placeholder="例：测评 Cursor IDE"
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!name.trim() || busy}
            loading={busy}
            onClick={() => name.trim() && onCreate(name.trim())}
          >
            {busy ? "创建中…" : "创建并继续"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteModal({ project, onCancel, onConfirm }: { project: Project; onCancel: () => void; onConfirm: () => void }) {
  const [typed, setTyped] = useState("");
  const ok = typed.trim() === project.name;
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="border-[var(--red)]">
        <DialogHeader title="永久删除项目？" onClose={onCancel} />
        <DialogBody className="space-y-3">
          <p className="text-sm text-[var(--body)]">
            这会<strong>永久删除</strong> <span className="text-[var(--red)] font-semibold">{project.name}</span> 及其所有数据。此操作不可恢复。
          </p>
          <FormField label="输入项目名以确认">
            <Input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={project.name}
              error
            />
          </FormField>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onCancel}>取消</Button>
          <Button variant="danger" size="sm" disabled={!ok} onClick={onConfirm}>
            永久删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

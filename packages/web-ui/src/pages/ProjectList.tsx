import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  useProjects,
  useCreateProject,
  useArchivedProjects,
  useArchiveProject,
  useRestoreProject,
  useDestroyProject,
} from "../hooks/useProjects";
import { useCliHealth } from "../hooks/useCliHealth";
import { CliHealthDot } from "../components/status/CliHealthDot";
import { TopNav } from "../components/layout/TopNav";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { SpriteIcon } from "../components/icons";
import { ArchivedProjectList } from "../components/project/ArchivedProjectList";
import { DeleteProjectModal } from "../components/project/DeleteProjectModal";
import type { Project } from "../api/types";

type ChipVariant = "active" | "waiting" | "legacy" | "deleted" | "warn";
function statusVariant(status?: string): ChipVariant {
  if (!status) return "waiting";
  const s = status.toLowerCase();
  if (s === "active" || s === "running") return "active";
  if (s === "legacy" || s === "archived") return "legacy";
  if (s === "deleted") return "deleted";
  if (s === "blocked" || s === "warn") return "warn";
  return "waiting";
}

type Tab = "active" | "archived";

export function ProjectList() {
  const [tab, setTab] = useState<Tab>("active");
  const { data: activeData, isLoading: activeLoading } = useProjects();
  const { data: archivedData, isLoading: archivedLoading } = useArchivedProjects(tab === "archived");
  const { data: cliHealth, loading: cliLoading } = useCliHealth();
  const create = useCreateProject();
  const archive = useArchiveProject();
  const restore = useRestoreProject();
  const destroy = useDestroyProject();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);

  const activeItems = activeData?.items ?? [];
  const archivedCount = activeData?.archived_count ?? 0;
  const activeCount = archivedData?.active_count ?? activeItems.length;
  const archivedItems = archivedData?.items ?? [];

  async function handleCreate() {
    if (!name.trim()) return;
    const p = await create.mutateAsync(name.trim());
    navigate(`/projects/${p.id}`);
  }

  async function handleArchive(id: string) {
    setMenuOpenId(null);
    await archive.mutateAsync(id);
  }
  async function handleRestore(id: string) {
    await restore.mutateAsync(id);
  }
  async function handleConfirmDelete(confirm: string) {
    if (!deleteTarget) return;
    await destroy.mutateAsync({ id: deleteTarget.id, confirm });
    setDeleteTarget(null);
  }

  return (
    <div data-testid="page-project-list" className="min-h-screen bg-bg-0 text-body">
      <div className="max-w-[1180px] mx-auto px-7 pt-7 pb-[72px] flex flex-col gap-6">
        <TopNav />

        <div className="flex items-center gap-3 justify-end">
          {cliHealth ? (
            <>
              <CliHealthDot label="CLAUDE" item={cliHealth.claude} />
              <CliHealthDot label="CODEX" item={cliHealth.codex} />
            </>
          ) : cliLoading ? (
            <>
              <span data-testid="cli-dot-placeholder" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 0, backgroundColor: "var(--hair-strong)" }} />
              <span data-testid="cli-dot-placeholder" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 0, backgroundColor: "var(--hair-strong)" }} />
            </>
          ) : null}
          <Link to="/style-panels" className="no-underline text-[12px] text-meta hover:text-accent border border-hair rounded-[2px] px-2 py-[3px]">风格面板</Link>
          <Link to="/knowledge" className="no-underline text-[12px] text-meta hover:text-accent border border-hair rounded-[2px] px-2 py-[3px]">知识库</Link>
          <Link to="/config" className="no-underline text-[12px] text-meta hover:text-accent border border-hair rounded-[2px] px-2 py-[3px]">⚙️ 配置工作台</Link>
          <Button variant="primary" onClick={() => setShowNew(true)}>新建项目</Button>
        </div>

        {showNew && (
          <Card variant="panel">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="项目名" className="w-full mb-3" />
            <div className="flex gap-2">
              <Button variant="primary" onClick={handleCreate}>创建</Button>
              <Button variant="secondary" onClick={() => setShowNew(false)}>取消</Button>
            </div>
          </Card>
        )}

        <Card halftone>
          <div className="flex justify-between items-end mb-[18px] gap-4">
            <div>
              <h2 className="font-sans font-semibold text-[15px] text-heading m-0">Projects</h2>
              <p className="text-[12px] text-meta m-0 mt-1">所有项目卡片，按最近更新倒序。</p>
            </div>
          </div>

          <div className="flex gap-2 mb-4 border-b border-hair">
            <button
              data-testid="tab-active"
              onClick={() => setTab("active")}
              className={`px-3 py-2 text-[13px] ${tab === "active" ? "border-b-2 border-accent text-heading" : "text-meta"}`}
            >
              进行中 ({activeCount})
            </button>
            <button
              data-testid="tab-archived"
              onClick={() => setTab("archived")}
              className={`px-3 py-2 text-[13px] ${tab === "archived" ? "border-b-2 border-accent text-heading" : "text-meta"}`}
            >
              已归档 ({archivedCount})
            </button>
          </div>

          {tab === "active" ? (
            activeLoading ? (
              <p className="text-meta text-[13px]">加载中…</p>
            ) : activeItems.length ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {activeItems.map((p) => (
                  <Card key={p.id} variant="agent" data-testid="project-card" className="hover:border-l-accent-soft relative">
                    <div className="flex justify-between items-start gap-2">
                      <Link to={`/projects/${p.id}`} className="font-semibold text-[14px] text-heading no-underline hover:text-accent">{p.name}</Link>
                      <div className="flex items-center gap-2">
                        <Chip variant={statusVariant(p.status)}>{p.status}</Chip>
                        <button
                          data-testid={`card-menu-btn-${p.id}`}
                          aria-label="actions"
                          onClick={() => setMenuOpenId(menuOpenId === p.id ? null : p.id)}
                          className="text-meta hover:text-heading px-1"
                        >
                          ⋯
                        </button>
                      </div>
                    </div>
                    <div className="font-mono-term text-[11px] text-meta tracking-[0.04em]">{p.stage} · UPDATED {new Date(p.updated_at).toLocaleString()}</div>
                    {menuOpenId === p.id && (
                      <div
                        data-testid={`card-menu-${p.id}`}
                        className="absolute right-2 top-10 bg-bg-1 border border-hair rounded-[2px] shadow-md z-10 flex flex-col"
                      >
                        <button className="px-3 py-2 text-left text-[13px] hover:bg-bg-2" onClick={() => handleArchive(p.id)}>归档</button>
                        <button className="px-3 py-2 text-left text-[13px] text-red-600 hover:bg-bg-2" onClick={() => { setMenuOpenId(null); setDeleteTarget(p); }}>硬删</button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 py-10 text-meta">
                <SpriteIcon size={32} />
                <p className="font-sans text-[13px] m-0">还没有项目 — no projects yet.</p>
              </div>
            )
          ) : archivedLoading ? (
            <p className="text-meta text-[13px]">加载中…</p>
          ) : (
            <ArchivedProjectList
              items={archivedItems}
              onRestore={handleRestore}
              onDelete={(p) => setDeleteTarget(p)}
            />
          )}
        </Card>

        {deleteTarget && (
          <DeleteProjectModal
            project={deleteTarget}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={handleConfirmDelete}
          />
        )}
      </div>
    </div>
  );
}

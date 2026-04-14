import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useProjects, useCreateProject } from "../hooks/useProjects";
import { useCliHealth } from "../hooks/useCliHealth";
import { CliHealthDot } from "../components/status/CliHealthDot";
import { TopNav } from "../components/layout/TopNav";
import { Card } from "../components/ui/Card";
import { Chip } from "../components/ui/Chip";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { SpriteIcon } from "../components/icons";

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

export function ProjectList() {
  const { data, isLoading } = useProjects();
  const { data: cliHealth, loading: cliLoading } = useCliHealth();
  const create = useCreateProject();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [showNew, setShowNew] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    const p = await create.mutateAsync(name.trim());
    navigate(`/projects/${p.id}`);
  }

  return (
    <div
      data-testid="page-project-list"
      className="min-h-screen bg-bg-0 text-body"
    >
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
              <span
                data-testid="cli-dot-placeholder"
                style={{ display: "inline-block", width: 8, height: 8, borderRadius: 0, backgroundColor: "var(--hair-strong)" }}
              />
              <span
                data-testid="cli-dot-placeholder"
                style={{ display: "inline-block", width: 8, height: 8, borderRadius: 0, backgroundColor: "var(--hair-strong)" }}
              />
            </>
          ) : null}
          <Link
            to="/style-panels"
            className="no-underline text-[12px] text-meta hover:text-accent border border-hair rounded-[2px] px-2 py-[3px]"
          >
            风格面板
          </Link>
          <Link
            to="/knowledge"
            className="no-underline text-[12px] text-meta hover:text-accent border border-hair rounded-[2px] px-2 py-[3px]"
          >
            知识库
          </Link>
          <Link
            to="/config"
            className="no-underline text-[12px] text-meta hover:text-accent border border-hair rounded-[2px] px-2 py-[3px]"
          >
            ⚙️ 配置工作台
          </Link>
          <Button variant="primary" onClick={() => setShowNew(true)}>
            新建项目
          </Button>
        </div>

        {showNew && (
          <Card variant="panel">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="项目名"
              className="w-full mb-3"
            />
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
              <p className="text-[12px] text-meta m-0 mt-1">
                所有项目卡片，按最近更新倒序。
              </p>
            </div>
          </div>

          {isLoading ? (
            <p className="text-meta text-[13px]">加载中…</p>
          ) : data?.length ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {data.map((p) => (
                <Card
                  key={p.id}
                  variant="agent"
                  data-testid="project-card"
                  className="hover:border-l-accent-soft"
                >
                  <div className="flex justify-between items-start gap-2">
                    <Link
                      to={`/projects/${p.id}`}
                      className="font-semibold text-[14px] text-heading no-underline hover:text-accent"
                    >
                      {p.name}
                    </Link>
                    <Chip variant={statusVariant(p.status)}>{p.status}</Chip>
                  </div>
                  <div className="font-mono-term text-[11px] text-meta tracking-[0.04em]">
                    {p.stage} · UPDATED {new Date(p.updated_at).toLocaleString()}
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-meta">
              <SpriteIcon size={32} />
              <p className="font-sans text-[13px] m-0">还没有项目 — no projects yet.</p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useProjects, useCreateProject } from "../hooks/useProjects";

export function ProjectList() {
  const { data, isLoading } = useProjects();
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
    <div className="max-w-5xl mx-auto p-8">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--green)" }}>
          Crossing Writer
        </h1>
        <button
          onClick={() => setShowNew(true)}
          className="px-4 py-2 rounded text-white"
          style={{ background: "var(--green)" }}
        >
          新建项目
        </button>
      </header>

      {showNew && (
        <div
          className="mb-6 p-4 bg-white rounded border"
          style={{ borderColor: "var(--border)" }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="项目名"
            className="w-full p-2 border rounded mb-3"
          />
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              className="px-4 py-2 rounded text-white"
              style={{ background: "var(--green)" }}
            >
              创建
            </button>
            <button
              onClick={() => setShowNew(false)}
              className="px-4 py-2 rounded border"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p>加载中…</p>
      ) : data?.length ? (
        <ul className="divide-y" style={{ borderColor: "var(--border)" }}>
          {data.map((p) => (
            <li key={p.id} className="py-4">
              <Link
                to={`/projects/${p.id}`}
                className="block hover:bg-gray-50 rounded p-2"
              >
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-gray-600">
                  {p.stage} · {p.status} · {new Date(p.updated_at).toLocaleString()}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-gray-500">还没有项目</p>
      )}
    </div>
  );
}

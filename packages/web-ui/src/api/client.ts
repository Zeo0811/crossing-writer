import type { Project, Expert } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return res.text() as unknown as Promise<T>;
}

export const api = {
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (name: string) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  uploadBriefText: (
    id: string,
    body: {
      text: string;
      productName?: string;
      productUrl?: string;
      notes?: string;
    },
  ) =>
    request<{ ok: true }>(`/api/projects/${id}/brief`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  uploadBriefFile: (
    id: string,
    file: File,
    extra: { productName?: string; productUrl?: string; notes?: string },
  ) => {
    const fd = new FormData();
    fd.append("file", file);
    for (const [k, v] of Object.entries(extra)) {
      if (v) fd.append(k, v);
    }
    return fetch(`/api/projects/${id}/brief`, {
      method: "POST",
      body: fd,
    }).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`);
      return r.json() as Promise<{ ok: true }>;
    });
  },
  getBriefSummary: (id: string) =>
    request<string>(`/api/projects/${id}/brief-summary`),
  listExperts: () =>
    request<{ topic_panel: Expert[] }>("/api/experts"),
};

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export function useProjects() {
  return useQuery({ queryKey: ["projects"], queryFn: api.listProjects });
}

export function useArchivedProjects(enabled = true) {
  return useQuery({
    queryKey: ["projects", "archived"],
    queryFn: api.listArchivedProjects,
    enabled,
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: ["projects", id],
    queryFn: () => api.getProject(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["projects"] });
  qc.invalidateQueries({ queryKey: ["projects", "archived"] });
}

export function useArchiveProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.archiveProject(id),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useRestoreProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.restoreProject(id),
    onSuccess: () => invalidateAll(qc),
  });
}

export function useDestroyProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; confirm: string }) =>
      api.destroyProject(args.id, args.confirm),
    onSuccess: () => invalidateAll(qc),
  });
}

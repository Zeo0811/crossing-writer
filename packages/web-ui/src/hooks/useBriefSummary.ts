import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export function useBriefSummary(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["brief-summary", id],
    queryFn: () => api.getBriefSummary(id),
    enabled,
    retry: false,
    refetchInterval: 3000, // 轮询，直到 summary 出现
  });
}

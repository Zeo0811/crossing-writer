import { useQuery } from "@tanstack/react-query";
import { apiMission } from "../api/client";

export function useCandidates(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["mission-candidates", id],
    queryFn: () => apiMission.getCandidates(id),
    enabled,
    retry: false,
    refetchInterval: 3000,
  });
}

import type { ExpertRecord } from "./expert-registry.js";

const MAX_PRESELECT = 5;
const TOP_CREATIVITY_N = 3;

export function computeCasePreselect(
  all: ExpertRecord[],
  missionExperts: string[],
): string[] {
  const top = [...all]
    .filter((e) => typeof e.creativity_score === "number")
    .sort((a, b) => (b.creativity_score ?? 0) - (a.creativity_score ?? 0))
    .slice(0, TOP_CREATIVITY_N)
    .map((e) => e.name);
  const union = new Set<string>([...missionExperts, ...top]);
  return Array.from(union).slice(0, MAX_PRESELECT);
}

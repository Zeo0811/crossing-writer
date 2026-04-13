import { appendFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface StoredEvent {
  ts: string;
  type: string;
  data: Record<string, any>;
}

export async function appendEvent(projectDir: string, event: Record<string, any>): Promise<StoredEvent> {
  await mkdir(projectDir, { recursive: true });
  const { type, ...data } = event;
  const stored: StoredEvent = {
    ts: new Date().toISOString(),
    type: String(type),
    data,
  };
  await appendFile(join(projectDir, "events.jsonl"), JSON.stringify(stored) + "\n", "utf-8");
  return stored;
}

export async function readEvents(projectDir: string): Promise<StoredEvent[]> {
  try {
    const buf = await readFile(join(projectDir, "events.jsonl"), "utf-8");
    return buf.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as StoredEvent);
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}

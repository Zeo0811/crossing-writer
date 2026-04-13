import { EventEmitter } from "node:events";
import type { StoredEvent } from "./event-log.js";

const emitter = new EventEmitter();
emitter.setMaxListeners(100);

export function publishEvent(projectId: string, event: StoredEvent): void {
  emitter.emit(`project:${projectId}`, event);
}

export function subscribe(
  projectId: string,
  handler: (e: StoredEvent) => void,
): () => void {
  const key = `project:${projectId}`;
  emitter.on(key, handler);
  return () => emitter.off(key, handler);
}

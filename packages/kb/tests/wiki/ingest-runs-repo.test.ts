import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSchema } from "../../src/wiki/migrations.js";
import {
  createRun, finishRun, appendRunOp, listRuns, getRun,
} from "../../src/wiki/ingest-runs-repo.js";

let db: Database.Database;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "runs-"));
  db = new Database(join(dir, "refs.sqlite"));
  ensureSchema(db);
});

describe("ingest-runs-repo", () => {
  it("createRun inserts a running row", () => {
    const runId = "r1";
    createRun(db, {
      runId, startedAt: "2026-04-17T10:00:00Z",
      accounts: ["acc1", "acc2"], articleIds: ["a1", "a2", "a3"],
      mode: "selected", model: "claude/sonnet",
    });
    const run = getRun(db, runId);
    expect(run).not.toBeNull();
    expect(run!.status).toBe("running");
    expect(run!.accounts).toEqual(["acc1", "acc2"]);
    expect(run!.article_ids).toEqual(["a1", "a2", "a3"]);
    expect(run!.mode).toBe("selected");
    expect(run!.model).toBe("claude/sonnet");
    expect(run!.ops).toEqual([]);
  });

  it("finishRun updates status + stats", () => {
    createRun(db, { runId: "r1", startedAt: "2026-04-17T10:00:00Z", accounts: [], articleIds: [], mode: "selected", model: "x" });
    finishRun(db, {
      runId: "r1", finishedAt: "2026-04-17T10:05:00Z", status: "done",
      stats: { pages_created: 2, pages_updated: 1, sources_appended: 3, images_appended: 0, conflict_count: 1, skipped_count: 4 },
    });
    const run = getRun(db, "r1");
    expect(run!.status).toBe("done");
    expect(run!.finished_at).toBe("2026-04-17T10:05:00Z");
    expect(run!.pages_created).toBe(2);
    expect(run!.skipped_count).toBe(4);
  });

  it("finishRun records error", () => {
    createRun(db, { runId: "r1", startedAt: "2026-04-17T10:00:00Z", accounts: [], articleIds: [], mode: "full", model: "x" });
    finishRun(db, { runId: "r1", finishedAt: "2026-04-17T10:01:00Z", status: "error", error: "boom" });
    const run = getRun(db, "r1");
    expect(run!.status).toBe("error");
    expect(run!.error).toBe("boom");
  });

  it("appendRunOp stores ops with sequential seq", () => {
    createRun(db, { runId: "r1", startedAt: "2026-04-17T10:00:00Z", accounts: [], articleIds: [], mode: "selected", model: "x" });
    appendRunOp(db, { runId: "r1", seq: 0, op: "upsert", path: "entities/A.md", articleId: "a1", createdPage: true });
    appendRunOp(db, { runId: "r1", seq: 1, op: "append_source", path: "entities/B.md", articleId: "a1" });
    appendRunOp(db, { runId: "r1", seq: 2, op: "error", articleId: "a2", error: "oops" });
    const run = getRun(db, "r1");
    expect(run!.ops).toHaveLength(3);
    expect(run!.ops[0]).toMatchObject({ seq: 0, op: "upsert", path: "entities/A.md", created_page: 1 });
    expect(run!.ops[2]).toMatchObject({ seq: 2, op: "error", error: "oops" });
  });

  it("listRuns returns newest first with limit", () => {
    for (let i = 0; i < 5; i += 1) {
      createRun(db, { runId: `r${i}`, startedAt: `2026-04-1${i}T10:00:00Z`, accounts: [], articleIds: [], mode: "full", model: "x" });
    }
    const runs = listRuns(db, { limit: 3 });
    expect(runs).toHaveLength(3);
    expect(runs[0].id).toBe("r4");
    expect(runs[2].id).toBe("r2");
  });

  it("listRuns filters by status", () => {
    createRun(db, { runId: "r1", startedAt: "2026-04-17T10:00:00Z", accounts: [], articleIds: [], mode: "full", model: "x" });
    createRun(db, { runId: "r2", startedAt: "2026-04-17T11:00:00Z", accounts: [], articleIds: [], mode: "full", model: "x" });
    finishRun(db, { runId: "r1", finishedAt: "2026-04-17T10:05:00Z", status: "done" });
    const runs = listRuns(db, { limit: 10, status: "done" });
    expect(runs.map((r) => r.id)).toEqual(["r1"]);
  });

  it("getRun returns null for missing id", () => {
    expect(getRun(db, "nope")).toBeNull();
  });
});

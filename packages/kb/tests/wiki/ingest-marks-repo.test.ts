import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureSchema } from "../../src/wiki/migrations.js";
import { upsertMark, listMarks, filterAlreadyIngested } from "../../src/wiki/ingest-marks-repo.js";

let db: Database.Database;

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "marks-"));
  db = new Database(join(dir, "refs.sqlite"));
  ensureSchema(db);
});

describe("ingest-marks-repo", () => {
  it("upsertMark inserts a new mark", () => {
    upsertMark(db, { articleId: "a1", runId: "r1", now: "2026-04-17T10:00:00Z" });
    const rows = listMarks(db, ["a1"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      article_id: "a1",
      first_ingested_at: "2026-04-17T10:00:00Z",
      last_ingested_at: "2026-04-17T10:00:00Z",
      ingest_count: 1,
      last_run_id: "r1",
    });
  });

  it("upsertMark increments on repeat", () => {
    upsertMark(db, { articleId: "a1", runId: "r1", now: "2026-04-17T10:00:00Z" });
    upsertMark(db, { articleId: "a1", runId: "r2", now: "2026-04-17T11:00:00Z" });
    const [row] = listMarks(db, ["a1"]);
    expect(row.first_ingested_at).toBe("2026-04-17T10:00:00Z");
    expect(row.last_ingested_at).toBe("2026-04-17T11:00:00Z");
    expect(row.ingest_count).toBe(2);
    expect(row.last_run_id).toBe("r2");
  });

  it("listMarks returns empty array for unknown ids", () => {
    expect(listMarks(db, ["nope"])).toEqual([]);
  });

  it("listMarks handles empty input", () => {
    expect(listMarks(db, [])).toEqual([]);
  });

  it("filterAlreadyIngested splits ids into marked vs fresh", () => {
    upsertMark(db, { articleId: "a1", runId: "r1", now: "2026-04-17T10:00:00Z" });
    upsertMark(db, { articleId: "a2", runId: "r1", now: "2026-04-17T10:00:00Z" });
    const result = filterAlreadyIngested(db, ["a1", "a2", "a3", "a4"]);
    expect(result.alreadyIngested.sort()).toEqual(["a1", "a2"]);
    expect(result.fresh.sort()).toEqual(["a3", "a4"]);
  });
});

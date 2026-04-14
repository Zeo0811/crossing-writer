import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  buildSelectionRewriteUserMessage,
  fetchReferenceBodies,
} from "../src/services/selection-rewrite-builder.js";

describe("buildSelectionRewriteUserMessage", () => {
  it("assembles all sections in order", () => {
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "BODY",
      selectedText: "SEL",
      userPrompt: "make it better",
      references: [
        { kind: "wiki", id: "a.md", title: "AI.Talk", content: "WIKIBODY" },
        {
          kind: "raw",
          id: "x",
          title: "Top",
          content: "RAWBODY",
          account: "花叔",
          published_at: "2024-08-28",
        },
      ],
    });
    expect(msg).toContain("[段落完整上下文]\nBODY");
    expect(msg).toContain("[需要改写的部分]\nSEL");
    expect(msg).toContain("## [wiki] AI.Talk\nWIKIBODY");
    expect(msg).toContain("## [raw] Top (花叔 2024-08-28)\nRAWBODY");
    expect(msg).toContain("[改写要求]\nmake it better");
    expect(msg.indexOf("[段落完整上下文]")).toBeLessThan(
      msg.indexOf("[引用素材]"),
    );
    expect(msg.indexOf("[引用素材]")).toBeLessThan(
      msg.indexOf("[改写要求]"),
    );
  });

  it("preserves reference ordering", () => {
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "B",
      selectedText: "S",
      userPrompt: "p",
      references: [
        { kind: "wiki", id: "1", title: "First", content: "one" },
        { kind: "raw", id: "2", title: "Second", content: "two" },
        { kind: "wiki", id: "3", title: "Third", content: "three" },
      ],
    });
    expect(msg.indexOf("First")).toBeLessThan(msg.indexOf("Second"));
    expect(msg.indexOf("Second")).toBeLessThan(msg.indexOf("Third"));
  });

  it("truncates per-ref bodies at 3000 chars", () => {
    const big = "x".repeat(4000);
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "B",
      selectedText: "S",
      userPrompt: "p",
      references: [{ kind: "wiki", id: "a", title: "A", content: big }],
    });
    expect(msg).toContain("[truncated]");
    expect(msg.match(/x/g)!.length).toBe(3000);
  });

  it("handles empty references", () => {
    const msg = buildSelectionRewriteUserMessage({
      sectionBody: "B",
      selectedText: "S",
      userPrompt: "p",
      references: [],
    });
    expect(msg).toContain("[引用素材]\n(无)");
  });
});

describe("fetchReferenceBodies", () => {
  it("reads wiki body and raw body_plain; skips missing", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sp09-fetch-"));
    mkdirSync(join(vault, "entities"), { recursive: true });
    writeFileSync(
      join(vault, "entities", "AI.Talk.md"),
      "---\ntitle: AI.Talk\ntype: entity\nsources: []\nlast_ingest: ''\n---\nHELLO",
    );
    const sqlitePath = join(vault, "kb.sqlite");
    const db = new Database(sqlitePath);
    db.exec("CREATE TABLE ref_articles (id TEXT PRIMARY KEY, body_plain TEXT)");
    db.prepare("INSERT INTO ref_articles (id, body_plain) VALUES (?, ?)").run(
      "a1",
      "RAWTEXT",
    );
    db.close();
    const warnings: string[] = [];
    const refs = await fetchReferenceBodies(
      [
        { kind: "wiki", id: "entities/AI.Talk.md", title: "AI.Talk" },
        { kind: "raw", id: "a1", title: "T" },
        { kind: "raw", id: "missing", title: "X" },
      ],
      { vaultPath: vault, sqlitePath },
      { warn: (m) => warnings.push(m) },
    );
    expect(refs).toHaveLength(2);
    expect(refs[0]!.content).toContain("HELLO");
    expect(refs[1]!.content).toBe("RAWTEXT");
    expect(warnings.some((w) => w.includes("missing"))).toBe(true);
  });

  it("warns and skips wiki page that does not exist", async () => {
    const vault = mkdtempSync(join(tmpdir(), "sp09-fetch-miss-"));
    const sqlitePath = join(vault, "kb.sqlite");
    const db = new Database(sqlitePath);
    db.exec("CREATE TABLE ref_articles (id TEXT PRIMARY KEY, body_plain TEXT)");
    db.close();
    const warnings: string[] = [];
    const refs = await fetchReferenceBodies(
      [{ kind: "wiki", id: "entities/Nope.md", title: "Nope" }],
      { vaultPath: vault, sqlitePath },
      { warn: (m) => warnings.push(m) },
    );
    expect(refs).toHaveLength(0);
    expect(warnings.length).toBe(1);
  });
});

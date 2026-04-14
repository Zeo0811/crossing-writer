import {
  readFileSync,
  writeFileSync,
  readdirSync,
  mkdirSync,
  unlinkSync,
  existsSync,
  statSync,
} from "node:fs";
import { join, basename } from "node:path";
import {
  parsePanel,
  serializePanel,
  type StylePanel,
  type StylePanelFrontmatter,
  type StylePanelRole,
} from "./style-panel-types.js";

const BASE_SUBDIR = join("08_experts", "style-panel");

export class StylePanelStore {
  constructor(private readonly vaultPath: string) {}

  private get baseDir(): string {
    return join(this.vaultPath, BASE_SUBDIR);
  }

  list(): StylePanel[] {
    const base = this.baseDir;
    if (!existsSync(base)) return [];
    const panels: StylePanel[] = [];
    for (const entry of readdirSync(base)) {
      const full = join(base, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        // nested: <account>/<role>-v<n>.md
        for (const file of readdirSync(full)) {
          if (!file.endsWith(".md")) continue;
          const abs = join(full, file);
          try {
            const raw = readFileSync(abs, "utf-8");
            panels.push(parsePanel(abs, raw));
          } catch (err) {
            console.warn(
              `[StylePanelStore] skipping unparseable panel ${abs}: ${(err as Error).message}`,
            );
          }
        }
      } else if (st.isFile() && entry.endsWith(".md")) {
        // top-level legacy file
        const raw = readFileSync(full, "utf-8");
        try {
          const parsed = parsePanel(full, raw);
          panels.push(parsed);
        } catch {
          // no frontmatter: synthesize a legacy panel view
          const account = basename(entry, ".md");
          panels.push({
            frontmatter: {
              account,
              role: "legacy",
              version: 0,
              status: "active",
              created_at: "",
              source_article_count: 0,
            },
            body: raw,
            absPath: full,
          });
        }
      }
    }
    return panels;
  }

  getLatestActive(account: string, role: StylePanelRole): StylePanel | null {
    const matching = this.list().filter(
      (p) =>
        p.frontmatter.account === account &&
        p.frontmatter.role === role &&
        p.frontmatter.status === "active",
    );
    if (matching.length === 0) return null;
    matching.sort((a, b) => b.frontmatter.version - a.frontmatter.version);
    return matching[0];
  }

  write(panel: StylePanel): string {
    const { account, role, version } = panel.frontmatter;
    const dir = join(this.baseDir, account);
    mkdirSync(dir, { recursive: true });
    const absPath = join(dir, `${role}-v${version}.md`);
    const raw = serializePanel(panel.frontmatter, panel.body);
    writeFileSync(absPath, raw, "utf-8");
    return absPath;
  }

  private pathFor(account: string, role: StylePanelRole, version: number): string {
    return join(this.baseDir, account, `${role}-v${version}.md`);
  }

  softDelete(account: string, role: StylePanelRole, version: number): boolean {
    const absPath = this.pathFor(account, role, version);
    if (!existsSync(absPath)) return false;
    const raw = readFileSync(absPath, "utf-8");
    const parsed = parsePanel(absPath, raw);
    const fm: StylePanelFrontmatter = { ...parsed.frontmatter, status: "deleted" };
    writeFileSync(absPath, serializePanel(fm, parsed.body), "utf-8");
    return true;
  }

  hardDelete(account: string, role: StylePanelRole, version: number): boolean {
    const absPath = this.pathFor(account, role, version);
    if (!existsSync(absPath)) return false;
    unlinkSync(absPath);
    return true;
  }

  /**
   * One-time migration pass for SP-06 legacy panels.
   * Rewrites old flat `<vault>/08_experts/style-panel/*.md` files that have no
   * frontmatter, injecting legacy-tagged frontmatter while preserving body.
   * Idempotent: files already carrying a `role:` are skipped.
   * Returns the number of files physically rewritten.
   */
  migrateLegacy(): number {
    const base = this.baseDir;
    if (!existsSync(base)) return 0;
    let migrated = 0;
    for (const entry of readdirSync(base)) {
      if (!entry.endsWith(".md")) continue;
      const full = join(base, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      const raw = readFileSync(full, "utf-8");
      // Skip if already has frontmatter with a role
      try {
        const parsed = parsePanel(full, raw);
        if (parsed.frontmatter && parsed.frontmatter.role) {
          continue;
        }
      } catch {
        // no frontmatter → migrate
      }
      const rawAccount = basename(entry, ".md");
      const account = rawAccount.endsWith("_kb")
        ? rawAccount.slice(0, -3)
        : rawAccount;
      const createdAt = st.mtime.toISOString();
      const fm: StylePanelFrontmatter = {
        account,
        role: "legacy",
        version: 1,
        status: "active",
        created_at: createdAt,
        source_article_count: 0,
        migrated_from_sp06: true,
      };
      writeFileSync(full, serializePanel(fm, raw), "utf-8");
      migrated += 1;
    }
    return migrated;
  }

  markLegacy(absPath: string): void {
    const raw = readFileSync(absPath, "utf-8");
    let fm: StylePanelFrontmatter;
    let body: string;
    try {
      const parsed = parsePanel(absPath, raw);
      fm = { ...parsed.frontmatter, role: "legacy" };
      body = parsed.body;
    } catch {
      const account = basename(absPath, ".md");
      fm = {
        account,
        role: "legacy",
        version: 0,
        status: "active",
        created_at: "",
        source_article_count: 0,
      };
      body = raw;
    }
    writeFileSync(absPath, serializePanel(fm, body), "utf-8");
  }
}

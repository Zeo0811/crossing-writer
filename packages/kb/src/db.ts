import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

export interface KbConfig {
  vaultPath: string;
  sqlitePath: string;
}

export function loadConfig(configPath: string): KbConfig {
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  const expand = (p: string) => p.startsWith("~") ? resolve(homedir(), p.slice(2)) : p;
  return {
    vaultPath: expand(raw.vaultPath),
    sqlitePath: expand(raw.sqlitePath),
  };
}

export function openDb(sqlitePath: string): Database.Database {
  const db = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  db.pragma("journal_mode = WAL");
  return db;
}

import { Database } from "bun:sqlite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WardPaths } from "./layout.ts";
import { resolveRepoRoot, resolveWardPaths } from "./layout.ts";

export type MigrationResult = {
  applied: number[];
  currentVersion: number;
};

type MigrationFile = {
  version: number;
  name: string;
  path: string;
};

export function openWardDatabase(paths = resolveWardPaths()): Database {
  const db = new Database(paths.dbFile, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  return db;
}

function ensureVersionTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

async function listMigrationFiles(repoRoot = resolveRepoRoot()): Promise<MigrationFile[]> {
  const migrationDir = join(repoRoot, "packages", "memory", "migrations");
  const entries = await readdir(migrationDir);
  return entries
    .filter((entry) => /^\d+_.+\.sql$/.test(entry))
    .map((entry) => {
      const [rawVersion] = entry.split("_", 1);
      return {
        version: Number(rawVersion),
        name: entry.replace(/^\d+_/, "").replace(/\.sql$/, ""),
        path: join(migrationDir, entry)
      };
    })
    .sort((a, b) => a.version - b.version);
}

export function getCurrentSchemaVersion(db: Database): number {
  ensureVersionTable(db);
  const row = db.query<{ version: number }, []>("SELECT COALESCE(MAX(version), 0) AS version FROM schema_version").get();
  return row?.version ?? 0;
}

export async function runMigrations(
  paths: WardPaths = resolveWardPaths(),
  opts: { repoRoot?: string } = {}
): Promise<MigrationResult> {
  const db = openWardDatabase(paths);
  try {
    ensureVersionTable(db);
    const appliedRows = db.query<{ version: number }, []>("SELECT version FROM schema_version").all();
    const appliedSet = new Set(appliedRows.map((row) => row.version));
    const applied: number[] = [];

    for (const migration of await listMigrationFiles(opts.repoRoot)) {
      if (appliedSet.has(migration.version)) {
        continue;
      }

      const sql = await readFile(migration.path, "utf8");
      const apply = db.transaction(() => {
        db.exec(sql);
        db.query("INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)")
          .run(migration.version, migration.name, new Date().toISOString());
      });
      apply();
      applied.push(migration.version);
    }

    return { applied, currentVersion: getCurrentSchemaVersion(db) };
  } finally {
    db.close();
  }
}

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BrainConfigSchema,
  BrainRegistrySchema,
  BrainRouteSchema,
  CostForecastSchema,
  CostLedgerEntrySchema,
  CostLedgerSummarySchema,
  QuotaLedgerEntrySchema,
  RecordCostLedgerEntrySchema,
  nowIso,
  type BrainAccounting,
  type BrainConfig,
  type BrainRegistry,
  type BrainRoute,
  type CostForecast,
  type CostLedgerEntry,
  type CostLedgerSummary,
  type QuotaLedgerEntry,
  type RecordCostLedgerEntryInput
} from "@ward/core";
import type { Database } from "bun:sqlite";
import { ensureWardLayout, resolveWardPaths, type WardPaths } from "./layout.ts";
import { openWardDatabase } from "./migrations.ts";

type BrainRow = {
  id: string;
  kind: string;
  runtime: string;
  auth: string;
  model: string | null;
  base_url: string | null;
  secret_ref: string | null;
  env_json: string;
  tags_json: string;
  capabilities_json: string;
  concurrency_cap: number;
  enabled: number;
  accounting: BrainAccounting;
  source: "system" | "user";
  created_at: string;
  updated_at: string;
};

type RouteRow = {
  concern: string;
  brain_ids_json: string;
  updated_at: string;
};

type CostRow = Omit<CostLedgerEntry, "accounting_mode"> & {
  accounting_mode: BrainAccounting;
};

type QuotaRow = QuotaLedgerEntry;

function withDb<T>(fn: (db: Database, paths: WardPaths) => T): T {
  const paths = resolveWardPaths();
  const db = openWardDatabase(paths);
  try {
    return fn(db, paths);
  } finally {
    db.close();
  }
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function brainFromRow(row: BrainRow): BrainConfig {
  return BrainConfigSchema.parse({
    id: row.id,
    kind: row.kind,
    runtime: row.runtime,
    auth: row.auth,
    model: row.model,
    base_url: row.base_url,
    secret_ref: row.secret_ref,
    env: JSON.parse(row.env_json),
    tags: JSON.parse(row.tags_json),
    capabilities: JSON.parse(row.capabilities_json),
    concurrency_cap: row.concurrency_cap,
    enabled: Boolean(row.enabled),
    accounting: row.accounting,
    source: row.source,
    created_at: row.created_at,
    updated_at: row.updated_at
  });
}

function routeFromRow(row: RouteRow): BrainRoute {
  return BrainRouteSchema.parse({
    concern: row.concern,
    brain_ids: JSON.parse(row.brain_ids_json),
    updated_at: row.updated_at
  });
}

function costFromRow(row: CostRow): CostLedgerEntry {
  return CostLedgerEntrySchema.parse(row);
}

function quotaFromRow(row: QuotaRow): QuotaLedgerEntry {
  return QuotaLedgerEntrySchema.parse(row);
}

function defaultBrains(timestamp = nowIso()): BrainConfig[] {
  return [
    {
      id: "stub-worker",
      kind: "stub",
      runtime: "simulated",
      auth: "none",
      model: null,
      base_url: null,
      secret_ref: null,
      env: {},
      tags: ["worker", "cheap", "offline"],
      capabilities: { tool_use: true, streaming: true, json_mode: true, max_context: 32768 },
      concurrency_cap: 2,
      enabled: true,
      accounting: "local",
      source: "system",
      created_at: timestamp,
      updated_at: timestamp
    },
    {
      id: "claude-code-cli",
      kind: "claude",
      runtime: "cli",
      auth: "subscription",
      model: null,
      base_url: null,
      secret_ref: null,
      env: {},
      tags: ["reasoning", "worker", "moderator"],
      capabilities: { tool_use: true, streaming: true, json_mode: true, max_context: null },
      concurrency_cap: 2,
      enabled: true,
      accounting: "subscription",
      source: "system",
      created_at: timestamp,
      updated_at: timestamp
    },
    {
      id: "codex-cli",
      kind: "codex",
      runtime: "cli",
      auth: "subscription",
      model: null,
      base_url: null,
      secret_ref: null,
      env: {},
      tags: ["worker", "alternative"],
      capabilities: { tool_use: true, streaming: true, json_mode: true, max_context: null },
      concurrency_cap: 2,
      enabled: true,
      accounting: "subscription",
      source: "system",
      created_at: timestamp,
      updated_at: timestamp
    },
    {
      id: "local-openai-compatible",
      kind: "openai-compatible",
      runtime: "local",
      auth: "none",
      model: null,
      base_url: "http://127.0.0.1:11434/v1",
      secret_ref: null,
      env: {},
      tags: ["fast", "private", "cheap", "offline"],
      capabilities: { tool_use: true, streaming: true, json_mode: true, max_context: 32768 },
      concurrency_cap: 1,
      enabled: false,
      accounting: "local",
      source: "system",
      created_at: timestamp,
      updated_at: timestamp
    }
  ];
}

function defaultRoutes(timestamp = nowIso()): BrainRoute[] {
  return [
    { concern: "default", brain_ids: ["claude-code-cli"], updated_at: timestamp },
    { concern: "orchestrator_brain", brain_ids: ["claude-code-cli"], updated_at: timestamp },
    { concern: "plan_mode_moderator", brain_ids: ["claude-code-cli"], updated_at: timestamp },
    { concern: "plan_mode_participants", brain_ids: ["claude-code-cli", "codex-cli"], updated_at: timestamp },
    { concern: "recap_and_brief", brain_ids: ["local-openai-compatible"], updated_at: timestamp },
    { concern: "alert_composer", brain_ids: ["local-openai-compatible"], updated_at: timestamp },
    { concern: "intent_parser", brain_ids: ["local-openai-compatible"], updated_at: timestamp },
    { concern: "diff_summarizer", brain_ids: ["local-openai-compatible"], updated_at: timestamp },
    { concern: "privacy_sensitive", brain_ids: ["local-openai-compatible"], updated_at: timestamp },
    { concern: "budget_exceeded_fallback", brain_ids: ["stub-worker"], updated_at: timestamp }
  ];
}

function registryYaml(registry: BrainRegistry): string {
  const lines = ["brains:"];
  for (const brain of registry.brains) {
    lines.push(`  - id: ${brain.id}`);
    lines.push(`    kind: ${brain.kind}`);
    lines.push(`    runtime: ${brain.runtime}`);
    lines.push(`    auth: ${brain.auth}`);
    if (brain.model) {
      lines.push(`    model: ${brain.model}`);
    }
    if (brain.base_url) {
      lines.push(`    base_url: ${brain.base_url}`);
    }
    lines.push(`    tags: [${brain.tags.join(", ")}]`);
    lines.push(`    concurrency_cap: ${brain.concurrency_cap}`);
    lines.push(`    enabled: ${brain.enabled ? "true" : "false"}`);
    lines.push(`    accounting: ${brain.accounting}`);
  }
  lines.push("", "routing:");
  for (const route of registry.routing) {
    lines.push(`  ${route.concern}: ${route.brain_ids.length === 1 ? route.brain_ids[0] : `[${route.brain_ids.join(", ")}]`}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function ensureBrainConfigFile(paths: WardPaths, registry: BrainRegistry): Promise<void> {
  const target = join(paths.home, "brains.yaml");
  if (existsSync(target)) {
    return;
  }
  await mkdir(paths.home, { recursive: true, mode: 0o700 });
  await writeFile(target, registryYaml(registry), { encoding: "utf8", mode: 0o600 });
}

export async function ensureBrainRegistry(paths = resolveWardPaths()): Promise<BrainRegistry> {
  await ensureWardLayout(paths);
  const registry = withDb((db) => {
    const existing = db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM brain_registry").get()?.count ?? 0;
    if (existing === 0) {
      const insertBrain = db.query(`
        INSERT INTO brain_registry (
          id, kind, runtime, auth, model, base_url, secret_ref, env_json, tags_json,
          capabilities_json, concurrency_cap, enabled, accounting, source, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const brain of defaultBrains()) {
        insertBrain.run(
          brain.id,
          brain.kind,
          brain.runtime,
          brain.auth,
          brain.model,
          brain.base_url,
          brain.secret_ref,
          JSON.stringify(brain.env),
          JSON.stringify(brain.tags),
          JSON.stringify(brain.capabilities),
          brain.concurrency_cap,
          brain.enabled ? 1 : 0,
          brain.accounting,
          brain.source,
          brain.created_at,
          brain.updated_at
        );
      }
      const insertRoute = db.query("INSERT INTO brain_route (concern, brain_ids_json, updated_at) VALUES (?, ?, ?)");
      for (const route of defaultRoutes()) {
        insertRoute.run(route.concern, JSON.stringify(route.brain_ids), route.updated_at);
      }
    }
    return getBrainRegistryFromDb(db);
  });
  await ensureBrainConfigFile(paths, registry);
  return registry;
}

function getBrainRegistryFromDb(db: Database): BrainRegistry {
  return BrainRegistrySchema.parse({
    brains: db.query<BrainRow, []>("SELECT * FROM brain_registry ORDER BY enabled DESC, id ASC").all().map(brainFromRow),
    routing: db.query<RouteRow, []>("SELECT * FROM brain_route ORDER BY concern ASC").all().map(routeFromRow)
  });
}

export function getBrainRegistry(): BrainRegistry {
  return withDb((db) => getBrainRegistryFromDb(db));
}

export function getBrain(brainId: string): BrainConfig | null {
  return withDb((db) => {
    const row = db.query<BrainRow, [string]>("SELECT * FROM brain_registry WHERE id = ?").get(brainId);
    return row ? brainFromRow(row) : null;
  });
}

export function setBrainEnabled(brainId: string, enabled: boolean): BrainConfig {
  return withDb((db) => {
    const timestamp = nowIso();
    db.query("UPDATE brain_registry SET enabled = ?, updated_at = ? WHERE id = ?").run(enabled ? 1 : 0, timestamp, brainId);
    const row = db.query<BrainRow, [string]>("SELECT * FROM brain_registry WHERE id = ?").get(brainId);
    if (!row) {
      throw new Error("Brain not found");
    }
    return brainFromRow(row);
  });
}

export function setBrainRoute(concern: string, brainIds: string[]): BrainRoute {
  return withDb((db) => {
    const timestamp = nowIso();
    for (const brainId of brainIds) {
      const exists = db.query<{ id: string }, [string]>("SELECT id FROM brain_registry WHERE id = ?").get(brainId);
      if (!exists) {
        throw new Error(`Brain not found: ${brainId}`);
      }
    }
    db.query(`
      INSERT INTO brain_route (concern, brain_ids_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(concern) DO UPDATE SET
        brain_ids_json = excluded.brain_ids_json,
        updated_at = excluded.updated_at
    `).run(concern, JSON.stringify(brainIds), timestamp);
    const row = db.query<RouteRow, [string]>("SELECT * FROM brain_route WHERE concern = ?").get(concern)!;
    return routeFromRow(row);
  });
}

export function recordCostLedgerEntry(input: RecordCostLedgerEntryInput): CostLedgerEntry {
  const parsed = RecordCostLedgerEntrySchema.parse(input);
  return withDb((db) => {
    const entryId = id("cost");
    const timestamp = nowIso();
    db.query(`
      INSERT INTO cost_ledger_entry (
        id, brain_id, accounting_mode, trigger, workspace_id, session_id, trace_id,
        tokens_in, tokens_out, dollars_estimate, duration_ms, invocations, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entryId,
      parsed.brain_id,
      parsed.accounting_mode,
      parsed.trigger,
      parsed.workspace_id ?? null,
      parsed.session_id ?? null,
      parsed.trace_id,
      parsed.tokens_in,
      parsed.tokens_out,
      parsed.dollars_estimate,
      parsed.duration_ms,
      parsed.invocations,
      timestamp
    );
    recordQuotaRows(db, parsed, timestamp);
    return costFromRow(db.query<CostRow, [string]>("SELECT * FROM cost_ledger_entry WHERE id = ?").get(entryId)!);
  });
}

function recordQuotaRows(db: Database, input: ReturnType<typeof RecordCostLedgerEntrySchema.parse>, timestamp: string): void {
  const day = timestamp.slice(0, 10);
  const rows = [
    { metric: "invocations", amount: input.invocations },
    { metric: "duration_ms", amount: input.duration_ms },
    { metric: "tokens", amount: input.tokens_in + input.tokens_out },
    { metric: "dollars", amount: input.dollars_estimate }
  ].filter((row) => row.amount > 0);
  const insert = db.query(`
    INSERT INTO quota_ledger (
      id, policy_id, scope, target, metric, window, window_start, amount,
      trace_id, workspace_id, session_id, created_at
    )
    VALUES (?, ?, 'brain', ?, ?, 'day', ?, ?, ?, ?, ?, ?)
  `);
  for (const row of rows) {
    insert.run(
      id("quota"),
      `brain.${input.brain_id}.daily_${row.metric}`,
      input.brain_id,
      row.metric,
      day,
      row.amount,
      input.trace_id,
      input.workspace_id ?? null,
      input.session_id ?? null,
      timestamp
    );
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getCostLedgerToday(date = todayIso()): CostLedgerSummary {
  return withDb((db) => {
    const rows = db.query<{
      brain_id: string;
      accounting_mode: BrainAccounting;
      invocations: number;
      duration_ms: number;
      tokens_in: number;
      tokens_out: number;
      dollars_estimate: number;
      entries: number;
    }, [string, string]>(`
      SELECT brain_id, accounting_mode,
        COALESCE(SUM(invocations), 0) AS invocations,
        COALESCE(SUM(duration_ms), 0) AS duration_ms,
        COALESCE(SUM(tokens_in), 0) AS tokens_in,
        COALESCE(SUM(tokens_out), 0) AS tokens_out,
        COALESCE(SUM(dollars_estimate), 0) AS dollars_estimate,
        COUNT(*) AS entries
      FROM cost_ledger_entry
      WHERE created_at >= ? AND created_at < ?
      GROUP BY brain_id, accounting_mode
      ORDER BY brain_id ASC
    `).all(`${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`);
    return CostLedgerSummarySchema.parse({
      date,
      entries: rows.reduce((sum, row) => sum + row.entries, 0),
      totals: {
        invocations: rows.reduce((sum, row) => sum + row.invocations, 0),
        duration_ms: rows.reduce((sum, row) => sum + row.duration_ms, 0),
        tokens_in: rows.reduce((sum, row) => sum + row.tokens_in, 0),
        tokens_out: rows.reduce((sum, row) => sum + row.tokens_out, 0),
        dollars_estimate: rows.reduce((sum, row) => sum + row.dollars_estimate, 0)
      },
      by_brain: rows.map((row) => ({
        brain_id: row.brain_id,
        accounting_mode: row.accounting_mode,
        invocations: row.invocations,
        duration_ms: row.duration_ms,
        tokens_in: row.tokens_in,
        tokens_out: row.tokens_out,
        dollars_estimate: row.dollars_estimate
      }))
    });
  });
}

export function listQuotaLedger(limit = 50): QuotaLedgerEntry[] {
  return withDb((db) => db.query<QuotaRow, [number]>(`
    SELECT * FROM quota_ledger
    ORDER BY created_at DESC
    LIMIT ?
  `).all(Math.max(1, Math.min(200, limit))).map(quotaFromRow));
}

export function getCostForecast(): CostForecast {
  const summary = getCostLedgerToday();
  const registry = getBrainRegistry();
  const generatedAt = nowIso();
  return CostForecastSchema.parse({
    generated_at: generatedAt,
    forecasts: registry.brains.map((brain) => {
      const row = summary.by_brain.find((item) => item.brain_id === brain.id);
      const metric = brain.accounting === "api" ? "dollars" : "invocations";
      const current = metric === "dollars" ? row?.dollars_estimate ?? 0 : row?.invocations ?? 0;
      return {
        brain_id: brain.id,
        metric,
        current,
        limit: null,
        projected_breach_at: null,
        status: "unknown"
      };
    })
  });
}

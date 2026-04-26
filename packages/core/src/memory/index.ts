import { z } from "zod";

export const WikiAuthorSchema = z.enum(["user", "llm"]);
export type WikiAuthor = z.infer<typeof WikiAuthorSchema>;

export const MemoryScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("universal") }),
  z.object({ kind: z.literal("workspace"), slug: z.string().min(1), workspace_id: z.number().int().positive().optional() })
]);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MemoryPageSummarySchema = z.object({
  scope: z.string(),
  page: z.string(),
  title: z.string(),
  path: z.string(),
  updated_at: z.string().nullable(),
  last_author: z.enum(["user", "llm", "system"]).nullable(),
  bytes: z.number().int().nonnegative()
});
export type MemoryPageSummary = z.infer<typeof MemoryPageSummarySchema>;

export const MemoryPageSchema = MemoryPageSummarySchema.extend({
  body: z.string()
});
export type MemoryPage = z.infer<typeof MemoryPageSchema>;

export const MemoryCommitSchema = z.object({
  hash: z.string(),
  author_name: z.string(),
  author_email: z.string(),
  authored_at: z.string(),
  subject: z.string()
});
export type MemoryCommit = z.infer<typeof MemoryCommitSchema>;

export const WriteWikiPageSchema = z.object({
  body: z.string(),
  author: WikiAuthorSchema.optional().default("user"),
  summary: z.string().optional()
});
export type WriteWikiPageInput = z.input<typeof WriteWikiPageSchema>;

export const AppendWikiPageSchema = z.object({
  section: z.string().min(1),
  author: WikiAuthorSchema.optional().default("llm"),
  summary: z.string().optional()
});
export type AppendWikiPageInput = z.input<typeof AppendWikiPageSchema>;

export const SearchableDocSchema = z.object({
  doc_id: z.string(),
  kind: z.enum(["wiki", "session", "plan_packet"]),
  scope: z.string(),
  workspace_id: z.number().int().positive().nullable(),
  title: z.string(),
  body: z.string(),
  path: z.string().nullable(),
  updated_at: z.string()
});
export type SearchableDoc = z.infer<typeof SearchableDocSchema>;

export const SearchHitSchema = z.object({
  doc_id: z.string(),
  kind: z.enum(["wiki", "session", "plan_packet"]),
  scope: z.string(),
  workspace_id: z.number().int().positive().nullable(),
  title: z.string(),
  path: z.string().nullable(),
  snippet: z.string(),
  rank: z.number(),
  updated_at: z.string()
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchQuerySchema = z.object({
  q: z.string().min(1),
  scope: z.string().optional(),
  limit: z.number().int().positive().max(50).optional().default(10)
});
export type SearchQueryInput = z.input<typeof SearchQuerySchema>;

export const WikiLintFindingSchema = z.object({
  id: z.string(),
  severity: z.enum(["info", "warn", "error"]),
  scope: z.string(),
  page: z.string(),
  message: z.string()
});
export type WikiLintFinding = z.infer<typeof WikiLintFindingSchema>;

export interface MemoryBackend {
  list(scope: MemoryScope): Promise<MemoryPageSummary[]>;
  read(scope: MemoryScope, page: string): Promise<MemoryPage>;
  write(scope: MemoryScope, page: string, body: string, author: WikiAuthor, summary?: string): Promise<MemoryPage>;
  append(scope: MemoryScope, page: string, section: string, author: WikiAuthor, summary?: string): Promise<MemoryPage>;
  history(scope: MemoryScope, page: string): Promise<MemoryCommit[]>;
  snapshot(out: string): Promise<void>;
}

export interface SearchBackend {
  index(doc: SearchableDoc): Promise<void>;
  indexBatch(docs: SearchableDoc[]): Promise<void>;
  query(q: string, opts?: { scope?: string; limit?: number }): Promise<SearchHit[]>;
  rebuild(): Promise<void>;
}

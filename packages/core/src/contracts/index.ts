import type { WardEvent } from "../schemas.ts";

export type HealthStatus = {
  ok: boolean;
  detail?: string;
};

export type Scope = {
  kind: "global" | "workspace" | "repo";
  id?: string;
};

export type TaskContract = {
  task_id?: string;
  goal: string;
  constraints: string[];
  acceptance_criteria: Array<{
    id?: string;
    statement: string;
    verification?: "test" | "review" | "screenshot" | "log" | "manual";
    required?: boolean;
  }>;
  file_plan?: Array<{
    path: string;
    intent: "create" | "modify" | "delete" | "inspect";
    owner_agent?: string;
  }>;
  max_iterations?: number;
  reporting_format: "pr" | "release_note" | "handoff" | "none" | "stream-json" | "markdown" | "structured";
};

export interface BrainAdapter {
  readonly kind: string;
  readonly runtimeKind: "cli" | "sdk" | "api" | "local";
  probe(): Promise<HealthStatus>;
  capabilities(): Record<string, unknown>;
  accounting(): "subscription" | "api" | "local";
  invoke(call: unknown): AsyncIterable<unknown>;
  cancel(callId: string): Promise<void>;
}

export interface HarnessAdapter {
  readonly kind: string;
  readonly runtimeKind: "cli" | "sdk" | "api" | "local";
  launch(input: unknown): Promise<{
    readonly sessionId: string;
    events(): AsyncIterable<WardEvent>;
    cancel(): Promise<void>;
  }>;
}

# Task 011: Learning Loop

- Status: `planned`
- Type: `feature`
- Version Impact: `minor`
- Priority: `medium`
- Depends on: 005, 008

## Summary

Capture outcomes, infer preferences and routing heuristics, and surface
reusable playbooks. Every learned rule must be inspectable and reversible.
Learning happens through state and memory updates — not fine-tuning.

## In Scope

### Outcome capture

- Migration `0011_outcomes.sql` extends `outcome_record`:
  - id, task_id, session_id, outcome (success / partial / failed),
    failure_reason, accepted (bool), user_override_summary,
    duration_ms, brain_id, created_at
- Auto-capture from Post-session mode + Intervention decisions
- Manual override: UI has "Mark as accepted / rejected / partial" on any
  session

### Preference inference

- Triggered nightly + on `outcome.recorded` event
- Inputs:
  - repeated user overrides (e.g., user always rejects PR creation by
    Codex on Project X → preference `codex.no_auto_pr.project-x`)
  - repeated planning patterns (e.g., user always asks for a "constraints"
    section in plan packets → bump that into Plan Mode template)
  - outcome ratios per (brain × task type)
- Output: `preference` rows with `source: "inferred"`, `confidence: 0.0–1.0`
- Threshold to apply: confidence ≥ 0.7 (configurable)
- Inferred prefs are **shadow-applied** (logged, suggested) before
  hard-applied; user must confirm before they take effect

### Routing heuristics

- Migration adds `routing_stat` table:
  - brain_id, concern, success_count, failure_count, fallback_count,
    avg_duration_ms, avg_dollars, last_updated
- Updated on `brain.call_completed` / `failed`
- `routing_advisor` background job suggests routing changes when one brain
  consistently outperforms another for a concern (Bayesian update style;
  details in implementation)
- Suggestions surface as banners in Settings → Brains; user accepts to
  modify `routing:` config

### AgentObserver registry (Communication layer)

Implement the `AgentObserver` extension seam from
[`001/extension-seams.md`](001/extension-seams.md) so WARD has context
on coding agents the user runs **outside** WARD. This is essential to
the peer-developer experience: most of the user's day is spent in
`claude` and `codex` directly, not in WARD-launched sessions.

Shipped observers in this task:

- **`ClaudeCodeObserver`**:
  - On install, writes hook scripts to `~/.claude/hooks.d/` (`Stop`,
    `Notification`, `PostToolUse`, `UserPromptSubmit`) — each is a
    short `curl` POST to WARD loopback with the device token.
  - Also tails `~/.claude/projects/<hash>/<session>.jsonl` for full
    transcript content.
  - Maps `cwd` to a workspace via `workspace_repo.local_path`.
- **`CodexObserver`**:
  - Watches `~/.codex/sessions/` for new rollout files.
  - Tails the active rollout for events; parses Codex's event JSON
    format to WARD events.
  - Same workspace mapping by repo path.

Both observers normalize to the canonical `external_agent.*` event
family and flow into the same event bus used by WARD-launched sessions.
Post-session mode runs at session end (Stop hook for Claude Code; rollout
end-marker for Codex), writing summaries to wiki and invalidating warm
cache like any other session.

#### Unmapped repos

When an external agent runs in a `cwd` not linked to any WARD workspace:

- Events are still ingested but tagged `workspace_id: null`.
- The next time the user opens WARD, an "Unmapped activity" card surfaces:
  "I noticed you ran `claude` in `~/Code/random-experiment` — want to
  make it a workspace?"
- Preference `external.unmapped_repo_prompt` (default `on`) controls the
  card. Off → events go to the Unmapped bucket silently.

#### Private / incognito external sessions

- **Wrapper alias**: `ward install-aliases` creates `claude-private` and
  `codex-private` shell aliases that run the agent with hooks disabled
  for that invocation (env var skips the WARD POST inside the hook script).
- **Inline token**: a prompt starting with `[private]` or containing
  `<ward:private>` flags the session as incognito at observation time.
  The observer still ingests events for live event-bus consumers but
  does not write to wiki, does not feed the learning loop, and does not
  appear in default session lists.

#### Volume coalescing

External activity volume can dwarf WARD-launched sessions. To keep cost
and noise bounded:

- **Threshold for Post-session writes**: only sessions with ≥ 3 turns OR
  ≥ 2 minutes wall-clock trigger a Post-session Brain call and a
  per-session wiki entry. Below threshold → one-line entry in
  `sessions.md` log only.
- **Daily rollup**: short below-threshold sessions accumulate; an
  end-of-day `Silent`-mode rollup writes a single digest entry per
  workspace per day.
- **Workspace soft cap**: configurable per-workspace daily limit on
  Post-session Brain calls (default 50/day). Excess sessions roll into
  the daily digest only. Quota events emitted per
  [`001/quota.md`](001/quota.md).

### Unified TriggerSource registry (Scheduling layer)

Implement the `TriggerSource` extension seam from
[`001/extension-seams.md`](001/extension-seams.md). All triggers — for
playbooks, alerts, scheduled runs — flow through one registry so adding
a new trigger kind is one adapter file.

```ts
interface TriggerSource {
  readonly kind: "cron" | "git" | "pr" | "ci" | "file" | "presence"
                | "inbound" | "webhook" | "calendar" | string;
  start(bus: EventBus): Promise<void>;
  stop(): Promise<void>;
  describe(spec: TriggerSpec): string;   // for UI
}
```

Shipped trigger kinds in this task:

- `cron` — local cron-style schedules (per local-tz)
- `git` — branch / commit detected (via filesystem watcher in 006)
- `pr` — PR opened / status changed / merged (via GitHub MCP)
- `ci` — CI status changes (via GitHub MCP / similar)
- `file` — file change in linked repo
- `presence` — presence state transition
- `inbound` — remote command arrived (consumes from 010)
- `calendar` — calendar event starting in N min (from calendar MCP, 005)

Future trigger kinds (cloud-scheduled remote, IoT, webhook from
arbitrary service) are one adapter; execution path unchanged. This is
the seam that makes "scheduled cloud tasks" a deployment change later
rather than a refactor.

### Playbooks

- Migration `0011_playbooks.sql`:
  - playbook (id, name, trigger_kind, trigger_spec_json, steps_json,
    confidence, source: user|inferred, enabled)
- Steps are typed actions:
  - `notify`, `set_preference`, `start_session`, `open_plan_mode`,
    `write_wiki_section`, `publish_to_pm`
- Playbook engine subscribes to `trigger.fired` events from the
  TriggerSource registry; matches against playbook bindings; dispatches
  steps through the Orchestration layer (autonomy gates apply).
- **Scheduled playbooks** drop out for free: a playbook with
  `trigger_kind: cron` and `trigger_spec_json: { cron: "0 6 * * *" }`
  fires daily at 06:00 local-tz. Used for things like "every morning at
  06:00, run the data backfill on project-y in a visible session, but
  pause for approval before destructive steps."
- Inferred playbooks come from recurring user action sequences (mined
  from audit log); same shadow → confirm flow as preferences.

### PM tool sync (consumer of 003 + 009)

- Background job pulls task status from configured PM MCP (Linear /
  GitHub Issues / Jira / Notion) on the workspaces with
  `publish_tasks_to` set (006).
- Reconciles `task.external_ref` to keep status in sync (closed in PM →
  closed in WARD; reopened externally → reopened in WARD).
- Polls every 5 min by default; can switch to webhook-driven later as
  another `TriggerSource` impl.
- New `inferrer` watches frequently-completed-but-not-marked-done tasks
  to suggest auto-close rules (shadow inbox).

### Reversal surfaces

- UI: Learning panel
  - Preferences (user vs inferred), with "disable" / "revert"
  - Routing heuristics with "reset to default"
  - Playbooks with "disable" / "delete"
- CLI:
  - `ward pref show|set|unset`
  - `ward routing show|reset`
  - `ward playbook list|enable|disable|delete`
- Git-backed wiki: any LLM wiki edit revertable via `git revert`

### Morning recommendations

- "What should I resume first?" enriched by learned data:
  - prefer the workspace where last session ended `partial` and the
    brain's success rate for that task type is high
  - surface playbooks bound to `morning_brief_open` for one-tap execution

### Inspector

- `ward learning explain <preference|routing|playbook> <id>` — shows
  evidence (which sessions / overrides drove the inference)

## Out of Scope

- Fine-tuning models
- Cross-install sharing of learned preferences
- Predictive task generation (too speculative for MVP)

## Acceptance Criteria

1. Marking 3 sessions as "user overrode brain choice" for the same
   concern triggers a routing suggestion banner.
2. Suggested preference / routing / playbook is **never auto-applied**
   without user confirmation.
3. Reverting an applied preference removes its effect on the next routing
   decision; audit log records the revert.
4. Playbook of type `morning_brief_open` shows up on the Overview screen
   on next open and runs when triggered.
5. `ward learning explain` returns the evidence set used for an inference.
6. Learning runs on schedule (nightly) and on outcome events; no manual
   trigger required.
7. All learned data is namespaced by scope (global / workspace) and
   inspectable.
8. `ward install-aliases` writes `claude-private` and `codex-private`
   aliases; using them produces incognito events that do not write to
   wiki and do not feed the learning loop.
9. `ClaudeCodeObserver` end-to-end: launching `claude` in a linked-repo
   `cwd` with hooks installed produces events on WARD's bus; session
   end writes a wiki summary; warm cache invalidates.
10. `CodexObserver` end-to-end equivalent.
11. Unmapped-repo card appears on next WARD open when an external
    agent runs in a `cwd` not linked to any workspace.
12. Volume threshold: a sub-threshold external session writes a single
    log line, no Post-session Brain call. Above threshold writes a full
    summary.

## Deliverables

- Migration `0011_outcomes_routing_playbooks.sql`
- Outcome capture hooks in Post-session mode and Intervention flow
- Inference engine (background job)
- Routing advisor
- Playbook engine + executor
- Learning UI panel
- CLI surfaces

## Risks

- Inference noise on small sample sizes: minimum-sample threshold (default
  5) before any suggestion is surfaced.
- User trust erosion if suggestions feel wrong: shadow-apply default,
  weekly digest of suggestions instead of in-flow popups.

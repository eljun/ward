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

### Playbooks

- Migration `0011_playbooks.sql`:
  - playbook (id, name, trigger_type, steps_json, confidence,
    source: user|inferred, enabled)
- Playbook trigger types:
  - `morning_brief_open`
  - `workspace_open`
  - `session_completed`
  - `git_branch_created`
- Steps are typed actions:
  - `notify`, `set_preference`, `start_session`, `open_plan_mode`,
    `write_wiki_section`
- Inferred playbooks come from recurring user action sequences (mined from
  audit log); same shadow → confirm flow as preferences

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

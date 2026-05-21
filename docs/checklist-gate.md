# Checklist Audit

Generic submission gate for tx mesh tasks. Profile-driven: any task that
produces a verifiable artifact can plug in via an `AuditProfile`. Reuses
tx's existing iterate-until-done lifecycle — the headless runner already
turns `QualityIterationError` into "append feedback, restart worker."

> **Status:** The framework lives at `src/hooks/post/checklist-audit.ts`
> and `src/hooks/post/audit-profiles/`. **No profiles ship in main.**
> The SWE-bench profile referenced as the running example below was
> developed under a research workload that has since been retired; it
> remains in `wip/checklist-gate` as a reference implementation. To use
> the framework, register your own `AuditProfile` via
> `registerAuditProfile()` and wire `lifecycle.post: [checklist-audit]`
> into the meshes that should be gated.

## Why

Forensic triage of 17 SWE-bench failures (`.ai/tmp/triage-fails.ts`) showed
15/17 were tight loops (same bash command run 4–27 times) and 2/17 were
short-engagement (agent quit after ~30 tools without running real tests).
Prompt tuning alone did not move the needle. The checklist audit addresses
both classes: loops stagnate on a single checklist item; short-engagement
patches are missing the early items. The audit catches both.

The pattern generalizes — any task that emits a verifiable artifact (a
diff, a built file, a test result) can be audited the same way.

## Mechanism

```
factory --task → mesh config has lifecycle.post: [checklist-audit]
                                  iteration: { maxIterations: 2, onFail: loop }

tx run → headless-runner spawns worker
       → worker produces artifact, exits
       → checklist-audit hook fires
         → resolves audit profile by AuditProfile.match(taskBody)
         → no match → return (fail-open)
         → match → profile.collectEvidence() → run audit (shared LLM core)
         → pass: continue, mesh exits
         → throw QualityIterationError → runner appends profile.buildGapFeedback()
                                         to taskBody, restarts worker
                                         (up to maxIterations)
```

## Architecture

### `AuditProfile` (src/hooks/post/audit-profiles/types.ts)

```ts
interface AuditProfile {
  name: string;
  match(taskBody: string): boolean;
  collectEvidence(taskBody: string): Promise<AuditEvidence>;
  checklist: readonly ChecklistItem[];
  buildGapFeedback?(blockingGaps: string[], evidence: AuditEvidence): string;
}

interface ChecklistItem {
  id: string;
  name: string;
  description: string;   // single source of truth — used in prompt AND audit
  blocking: boolean;
}

interface AuditEvidence {
  key: string;                          // verdict filename, e.g. instance_id
  artifact: string;                     // diff, file, output
  artifactLabel: string;                // "git diff base..tag", "stdout", etc.
  trajectory?: string;                  // optional tool log tail
  contextInfo: Record<string, string>;  // shown in audit prompt header
}
```

A profile owns three things:
1. **Detection** — `match(taskBody)`. First match wins.
2. **Evidence** — `collectEvidence`. Reads diff / file / log / etc.
3. **Rubric** — `checklist`. Same items used in agent prompt and audit.

Profiles register themselves at module load via `registerAuditProfile`.

### Generic hook (src/hooks/post/checklist-audit.ts)

The hook is profile-agnostic:

1. Fetches profile via `findAuditProfile(taskBody)`. Skip if none.
2. Calls `profile.collectEvidence(taskBody)`.
3. Renders a single shared audit prompt: profile name, context info, checklist
   (rendered from `ChecklistItem[]`), blocking rule (computed from
   `blocking: true` items), evidence header + body, trajectory.
4. Calls Sonnet (no tools, single turn) for structured per-item verdict.
5. Persists to `.ai/tx/audit-verdicts/<profile>/<key>.yaml`.
6. Calls `utils.writeResultMessage` for sys-msgs visibility.
7. Throws `QualityIterationError(profile.buildGapFeedback(...) ?? default)`
   on block.

Fail-open everywhere: parse error, evidence-collection crash, auditor
network error → return without throw. Better to submit and score than to
lose a run.

### Profile registry (src/hooks/post/audit-profiles/index.ts)

Importing the barrel registers all built-in profiles as a side effect.
Currently just `swebenchAuditProfile`. New profiles add a file under
`audit-profiles/`, register in `index.ts`. No changes to the hook itself.

### Built-in: swebench profile (src/hooks/post/audit-profiles/swebench.ts)

- **Match**: regex `/^# SWE-bench: \S+/m` against taskBody.
- **Evidence**: parses `Base commit:` and `checked out at` from the
  prompt; runs `git diff base..tx-patch-{id}` from the worktree;
  filters `.ai/tx/logs/activity.jsonl` rows containing the instance_id
  for trajectory tail (head 4000 + tail 4000 chars on long runs).
- **Checklist**: six items (reproduced, root_cause, minimal_fix,
  targeted_test_passes, no_regressions, edge_cases). Three are blocking.
- **Gap feedback**: includes `git tag -f tx-patch-{id}` instructions for
  the retry to re-tag.

The `SWEBENCH_CHECKLIST` constant is also imported by `buildSwebenchPrompt`
in `src/cli/factory.ts` so the agent's prompt and the auditor's rubric are
literally the same array. No drift possible.

## Lifecycle wiring (src/cli/factory.ts:444 ensureChecklistAuditLifecycle)

When task mode emits a generated mesh, factory writes:

```yaml
lifecycle:
  post:
    - checklist-audit
iteration:
  maxIterations: 2
  onFail: loop
```

into the generated `config.yaml`. Idempotent. Migrates legacy
`swebench-audit` entries to `checklist-audit`.

## Adding a new profile

1. Define `ChecklistItem[]` with `description` written so it works as
   both prompt guidance and audit criterion.
2. Implement `match(taskBody)` — pick a stable marker your task injects.
3. Implement `collectEvidence(taskBody)` — read whatever artifact your
   task produces (file, command output, git diff, etc.).
4. Optionally implement `buildGapFeedback` if your retry instructions are
   non-generic.
5. Register in `src/hooks/post/audit-profiles/index.ts`.
6. Have your task's prompt include the matcher marker + render the
   checklist from your profile constant (parity with auditor).
7. Wire `lifecycle.post: [checklist-audit]` in your mesh config.

That's it. The hook, the registry, the LLM call, the verdict persistence,
the iteration loop — all reused.

## Verifying

After a `bench/solve.sh <instance>` run:

```sh
cat .ai/tx/audit-verdicts/swebench/<instance>.yaml
grep -A 4 "lifecycle:" .ai/tx/generated-meshes/<hash>/config.yaml
grep "checklist-audit\|quality:retry" .ai/tx/logs/v4.jsonl | tail
```

## Limitations

- Auto-detect via `match()` requires each profile to have an unambiguous
  task-body marker. Two profiles matching the same task body would
  resolve to whichever registered first (currently impossible — only one
  profile shipping).
- `quality:preflight` already exists for LLM-derived per-task checklists
  (against `workerOutput` text). The checklist-audit pattern complements
  rather than replaces it: preflight is good for free-form tasks where
  the rubric depends on the prompt; profile-based audit is good for
  task families with a fixed verifiable artifact (a diff, a built
  binary, a test result).
- Single audit profile per task, single audit pass per worker exit.
  Not a general orchestrator — that's what `validation-code` and
  workflow routing are for.

## Files

- `src/hooks/post/audit-profiles/types.ts` — interfaces
- `src/hooks/post/audit-profiles/registry.ts` — registration + lookup
- `src/hooks/post/audit-profiles/swebench.ts` — the swebench profile
- `src/hooks/post/audit-profiles/index.ts` — barrel + side-effect register
- `src/hooks/post/checklist-audit.ts` — the generic post-hook
- `src/hooks/post/index.ts` — hook registration with the runner
- `src/cli/factory.ts` (`buildSwebenchPrompt`, `ensureChecklistAuditLifecycle`)
- `bench/run-task.sh` — orchestration: factory → tx run → extract-patch

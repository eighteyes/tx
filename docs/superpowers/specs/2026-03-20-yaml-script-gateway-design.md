# YAML Script Gateway — Design Spec

Script-mediated YAML I/O for narrative-engine-v2. Agents produce and consume JSON through validated scripts instead of reading or writing YAML directly.

Canonical reference: heathers-hope game data. Schema designs are derived from HH's production structures, corrected where drift has occurred.

## Problem

Agents writing YAML directly causes structural malformation and schema drift. In long games (100+ turns), agents reading entire YAML files wastes context. Campaign.sh proved that script-mediated writes work — this extends the pattern to all game data I/O with schema-driven write modes that handle overwrites, appends, patches, and deltas.

## Approach

JSON-in, YAML-out via jq validation. No new dependencies. Six scripts covering three data levels (turn, campaign, game), each with a read and write interface. Schemas enforce a fixed top-level skeleton while allowing freeform dynamic subsections. Write mode (overwrite, append, patch, delta) and state transition rules are defined in schemas, eliminating the need for separate ops scripts.

## Script Surface

```
turn-read.sh        turn-write.sh
campaign-read.sh    campaign-write.sh
game-read.sh        game-write.sh
```

All scripts live in `meshes/narrative-engine-v2/scripts/`.

**Two concerns:**

```
read     explore + query data, return scoped JSON
write    validate JSON, apply write mode, write YAML
```

Agents always interact through the same interface — `echo JSON | *-write.sh`. The schema determines how the write is applied.

## Write Interface

```
echo '<json>' | {level}-write.sh {path} {artifact}
```

**Entity-scoped artifacts** use slash addressing:

```
echo '<json>' | campaign-write.sh $CP character/kaitlin
echo '<json>' | game-write.sh $GP character/heather
echo '<json>' | campaign-write.sh $CP bond/kaitlin_heather
```

The artifact prefix (`character`) resolves the schema. The ID after the slash (`kaitlin`) selects the file within `entities/characters/kaitlin.yaml` (or `entities/bonds/`, etc.).

**Append with target selection** uses `--target` for multi-section artifacts:

```
echo '<json>' | campaign-write.sh $CP continuity --target=.used_factoids
echo '<json>' | campaign-write.sh $CP continuity --target=.encounters.moth.details_revealed
```

**Pipeline:**
1. Read JSON from stdin
2. Load schema from `schemas/{level}/{artifact}.schema.jq` (slash-addressed artifacts use the prefix)
3. Validate: required keys, no unknown top-level keys, type checks
4. Apply write mode (schema-defined):
   - `overwrite` → write directly
   - `append` → read existing, append to `--target` array, write
   - `patch` → read existing, deep/shallow merge, validate transitions if defined, write
   - `delta` → read existing, apply arithmetic to delta fields, write
5. On fail → exit non-zero, structured error JSON to stderr
6. On pass → convert to YAML via `yq -P`, write to target file

**Exit codes:**

```
0    success, YAML written
1    validation failure (schema — unknown keys, missing keys, type mismatch)
2    malformed JSON (couldn't parse input)
3    unknown artifact type (no schema file found; stderr includes known artifacts)
4    write mode error (invalid transition, entity not found, delta target missing)
```

**Error output (stderr):**

```json
{"ok": false, "artifact": "fates", "errors": [
  {"type": "unknown_key", "key": "vibes", "allowed": ["branches","seeds","trajectory_status","world_state"]},
  {"type": "missing_key", "key": "branches", "expected_type": "array"},
  {"type": "type_mismatch", "key": "seeds", "expected": "array", "got": "string"},
  {"type": "invalid_transition", "field": "status", "from": "planted", "to": "fired", "allowed": ["approaching","active"]}
]}
```

**Validation is strict.** Unknown top-level keys are rejected (exit 1). No stripping, no warnings, no passthrough. Agents retry with corrected JSON.

**Valid artifacts are discovered dynamically** from the `schemas/{level}/` directory. Exit code 3 includes the list of known artifacts.

## Write Modes

All write modes are defined in the schema. Agents pipe JSON the same way regardless of mode.

```
Mode        Agent sends              Script does
────────────────────────────────────────────────────────────────
overwrite   full object              validate → write
append      new entries only         validate → read existing → append to --target → write
patch       partial object           validate → read existing → merge → validate transitions → write
delta       relative values          validate → read existing → arithmetic on delta fields → write
```

**Overwrite** — default. Replaces the entire file. Used for turn-level artifacts written fresh each turn (fates, collisions, scene-script, etc.).

**Append** — adds entries to a specific array without touching existing data. Agent sends only the new entries and specifies `--target` to select which section. Schema defines `allowed_targets` — the set of valid append paths. Used for history artifacts (continuity factoids, encounter details, episodes, arc question/seed history).

**Patch** — merges incoming keys into existing object, leaving untouched keys alone. For array-structured artifacts, patch uses the `id` field to locate the target entry. Supports optional state transition validation: if `valid_transitions` is defined in the schema, the script checks that the current→new state change is legal before merging. Used for entity state updates, trajectory lifecycle, condition lifecycle.

**Delta** — applies arithmetic to specified fields. Agent sends relative values (`{"pressure": -5}`), script reads current value, computes result, writes. Used for arc pressure adjustments.

## Read Interface

```
{level}-read.sh {path} [artifact] [flags]
```

Returns JSON to stdout. Artifact is optional for cross-artifact operations (`--list`, `--search`, `--discover`).

Entity-scoped reads use slash addressing:

```
campaign-read.sh $CP character/kaitlin --keys
campaign-read.sh $CP character --list         → lists all character entity IDs
game-read.sh $GP bond --list                  → lists all bond entity IDs
```

**Browse:**
```
--list              list artifact files / entity IDs (artifact optional)
--keys              top-level structure and counts
--discover          surface dynamic keys within freeform zones (artifact optional)
--search="X"        grep across artifacts (artifact optional — searches all when omitted)
```

**Skim:**
```
--summary           compressed view (counts, latest entries, not full history)
```

**Read:**
```
--section=X         full content of one section
--entity=X          scoped to one entity
--since=N           from turn N onward (filters by --index-on field)
--before=N          up to turn N exclusive (filters by --index-on field)
--since=N --before=M  turn slice
--index-on=FIELD    field name containing the turn number for filtering (default: "turn")
```

Flags compose: `--entity=moth --since=90 --before=100 --section=facts`

**Turn filtering convention:** `--since` and `--before` filter array entries by a numeric field. The field defaults to `turn` but can be overridden with `--index-on`. This works on any artifact where entries are turn-stamped (continuity factoids, episodes, arc questions, trajectory events, etc.).

**`--discover` example:**
```
campaign-read.sh $CP continuity --discover --since=90
→ {"freeform_keys": {"encounters": ["moth", "cassius"], "used_factoids": 3}}
```

**`--search` example (cross-artifact, no artifact argument):**
```
campaign-read.sh $CP --search="gate"
→ {"matches": [{"file": "continuity.yaml", "key": "used_factoids[2]", "preview": "The south gate was destroyed"}]}
```

**`--search` example (scoped to artifact):**
```
campaign-read.sh $CP continuity --search="gate"
→ {"matches": [{"key": "used_factoids[2]", "preview": "The south gate was destroyed"}]}
```

**Turn-level cross-turn search:**
```
turn-read.sh $TURNS_ROOT --search="moth" --since=90 --before=100
→ {"matches": [{"turn": 92, "file": "collisions.yaml", "key": "...", "preview": "..."}]}
```

Turn-read.sh, when given the turns root directory instead of a single workspace, searches across turn directories.

## Schema Layer

Schemas live in `meshes/narrative-engine-v2/scripts/schemas/`:

```
schemas/
  validate-common.jq      shared validation logic
  turn/
    context.schema.jq
    intent.schema.jq
    action-lock.schema.jq
    director-notes.schema.jq
    collisions.schema.jq
    fates.schema.jq
    dramaturg-notes.schema.jq
    entropy-tables.schema.jq
    entropy-selection.schema.jq
    resolution.schema.jq
    threads.schema.jq
    pov-resolution.schema.jq
    sim-plan.schema.jq
    sim-progress.schema.jq
    scene-script.schema.jq
    scene-outline.schema.jq
    violations.schema.jq
    visual.schema.jq
    calibration-state.schema.jq
  campaign/
    arc.schema.jq
    state.schema.jq
    continuity.schema.jq
    trajectories.schema.jq
    character.schema.jq
    bond.schema.jq
    condition.schema.jq
  game/
    author.schema.jq
    setting.schema.jq
    arc.schema.jq
    character.schema.jq
    bond.schema.jq
```

**Each schema declares up to eight things:**

```jq
def required: {"branches": "array", "seeds": "array"};
def allowed: ["branches", "seeds", "trajectory_status", "world_state"];
def freeform: ["trajectory_status"];
def write_mode: "overwrite";
def allowed_targets: [];
def patch_strategy: "deep_merge";
def delta_fields: [];
def valid_transitions: {};
include "validate-common";
validate
```

- `required` — keys that must exist, with expected types
- `allowed` — full set of permitted top-level keys (required + optional)
- `freeform` — subsections where dynamic keys are allowed (container type enforced, contents unchecked)
- `write_mode` — `"overwrite"` | `"append"` | `"patch"` | `"delta"`
- `allowed_targets` — for append mode: valid jq paths for `--target` flag (e.g., `[".used_factoids", ".encounters", ".notes"]`)
- `patch_strategy` — for patch mode: `"deep_merge"` (recurse into nested objects) or `"shallow_merge"` (replace at first key level)
- `delta_fields` — for delta mode: list of field paths that receive arithmetic (e.g., `["pressure"]`)
- `valid_transitions` — for patch mode: optional state machine rules (e.g., `{"active": ["fired", "expired"]}`)

**Fixed skeleton, dynamic flesh.** Top-level structure is rigid. Freeform zones let agents create dynamic keys for story-specific data. Write mode and mutation rules are part of the schema contract — agents pipe JSON the same way regardless of mode.

**Example schemas by write mode:**

Overwrite (fates — written fresh each turn):
```jq
def required: {"branches": "array", "trajectory_status": "object", "seeds": "array"};
def allowed: ["branches", "trajectory_status", "seeds", "world_state"];
def freeform: ["trajectory_status"];
def write_mode: "overwrite";
```

Append with multiple targets (continuity — history grows monotonically):
```jq
def required: {};
def allowed: ["game", "campaign", "created", "version", "used_factoids", "encounters", "notes"];
def freeform: ["encounters"];
def write_mode: "append";
def allowed_targets: [".used_factoids", ".encounters", ".notes"];
```

Patch with transitions (trajectory — status lifecycle):
```jq
def required: {"id": "string"};
def allowed: ["id", "status", "turn", "outcome", "desc", "deadline", "source"];
def freeform: [];
def write_mode: "patch";
def patch_strategy: "deep_merge";
def valid_transitions: {"planted": ["approaching","active"], "active": ["fired","expired"]};
```

Delta (arc — pressure adjustments):
```jq
def required: {};
def allowed: ["pressure", "momentum", "phase"];
def freeform: [];
def write_mode: "delta";
def delta_fields: ["pressure"];
```

**validate-common.jq contract:**
- Input: the JSON blob being validated
- Reads all schema declarations from the including schema
- Checks: required keys present with correct types, no keys outside allowed set, freeform zone values are correct container types
- For append mode: validates `--target` is in `allowed_targets`, validates incoming entries against expected structure for that target
- For patch mode: locates target entry by `id` field in array-structured artifacts, validates transition legality if `valid_transitions` is defined
- For delta mode: validates delta fields exist and are numeric
- On success: outputs the validated JSON (passable to write pipeline)
- On failure: outputs structured error JSON (`{"ok": false, ...}`)
- Loaded via `jq -L schemas/ -f schemas/{level}/{artifact}.schema.jq`

## Entity Addressing

Characters, bonds, and other entity types live in per-entity files under `entities/`:

```
{game_or_campaign}/entities/characters/kaitlin.yaml
{game_or_campaign}/entities/characters/heather.yaml
{game_or_campaign}/entities/bonds/kaitlin_heather.yaml
```

Scripts use slash addressing to select entity files:

```
# Write
echo '<json>' | game-write.sh $GP character/kaitlin
echo '<json>' | campaign-write.sh $CP bond/kaitlin_heather

# Read
game-read.sh $GP character --list          → ["kaitlin", "heather"]
game-read.sh $GP character/kaitlin --keys  → top-level structure
campaign-read.sh $CP character/kaitlin --section=traits
campaign-read.sh $CP character/kaitlin --section=episodes --since=90
```

The artifact prefix maps to a directory under `entities/`:
- `character` → `entities/characters/`
- `bond` → `entities/bonds/`
- Additional entity types follow the same pattern

Schema resolution uses the prefix: `character/kaitlin` loads `character.schema.jq`.

**No `protagonist.yaml`.** The protagonist is a character entity with `protagonist: true` in its data. No special file.

**No monolithic `entities.yaml`.** Entity data lives in per-entity files only. Any existing monolithic `entities.yaml` at game or campaign level is legacy and should be migrated to per-entity files.

## Arc Schema Restructure

HH's current `arc.yaml` uses dynamic keys like `seeds_turn_0`, `questions_turn_0` — this is schema drift caused by agents inventing per-turn keys instead of appending to arrays.

**Target structure (append-friendly):**

```yaml
# Instead of:
seeds_turn_0:
  planted: [...]
questions_turn_0:
  - {text: ..., pressure: 45}
seeds_turn_1:
  planted: [...]

# Use:
seed_history:
  - turn: 0
    planted: [...]
    activated: [...]
question_history:
  - turn: 0
    questions:
      - {id: q1, text: ..., pressure: 45, status: active}
  - turn: 1
    questions:
      - {id: q1, text: ..., pressure: 52, status: active, pressure_delta: 7}
```

This makes arc data queryable with `--since`/`--before` and writable with append mode:

```
echo '<json>' | campaign-write.sh $CP arc --target=.seed_history
echo '<json>' | campaign-write.sh $CP arc --target=.question_history
```

The top-level arc fields (`arc_pressure`, `momentum`, `phase`) remain delta-writable. The history arrays are append-writable. **Arc uses both delta and append modes** — the schema supports this by defining `write_mode: "delta"` with `allowed_targets` for the history sections, and the write script checks: if `--target` is provided, use append semantics on that target; otherwise, use delta semantics on the top-level fields.

## Artifacts by Level

**Turn artifacts:**

```
Artifact             Writer Agent(s)       Write Mode    Notes
──────────────────────────────────────────────────────────────────────────
context              init-turn             overwrite     turn setup, entropy pool, scene
intent               init-turn             overwrite     player action decomposition
action-lock          init-turn             overwrite     inviolable locked facts
director-notes       init-turn             overwrite     player creative direction
collisions           gravity               overwrite     pressure collision map
fates                architect             overwrite     world possibility branches
dramaturg-notes      architect             overwrite     story guidance, atmosphere, seeds
entropy-tables       architect             overwrite     weighted probability tables
entropy-selection    architect             overwrite     resolved entropy outcomes
resolution           architect             overwrite     outcomes, state changes, arc updates
threads              architect             overwrite     life thread extraction
pov-resolution       architect             overwrite     POV character resolution
sim-plan             sim-planner           overwrite     beat plan checkpoint
sim-progress         sim-tables/voices     patch         simulator checkpoint (incremental)
scene-outline        architect/sim         overwrite     beat structure, word targets, pacing
scene-script         sim-voices            overwrite     beat-by-beat scene script
violations           narrator/lint agents  append        aggregated lint violations
visual               visual                overwrite     visualization briefs
calibration-state    calibrator            patch         HITL calibration tracker
```

**Excluded from gateway (non-YAML or non-structured):**
- `prose-draft.md`, `prose.md`, `summary.md` — markdown, not YAML
- `concordance.txt`, `dialogue-pairs.txt` — plain text analysis
- `entropy_tables/` fragments — intermediate; merged into `entropy-tables.yaml`
- `beat_tables/` fragments — intermediate audit trail
- `campaign-snapshot/` — full state copies made by init-turn for redo; file copies, not agent writes

**Campaign artifacts:**

```
Artifact             Writer Agent(s)       Write Mode    Notes
──────────────────────────────────────────────────────────────────────────
arc                  scribe                delta+append  delta for pressure/momentum; append for seed/question history
state                scribe                overwrite     location, momentum, turn outcomes, next setup
continuity           scribe                append        used factoids, encounters, notes (--target selects section)
trajectories         scribe                patch         chekhov's guns (with transitions)
character/{id}       scribe                patch         campaign-evolved entity state, episodes, traits
bond/{id}            scribe                patch         relationship dimensions, history
condition/{id}       scribe                patch         entity conditions (with transitions)
```

**Game artifacts:**

```
Artifact             Writer Agent(s)       Write Mode    Notes
──────────────────────────────────────────────────────────────────────────
author               calibrator            overwrite     prose voice, pacing, permissions
setting              calibrator            overwrite     world rules, geography, tone
arc                  calibrator            overwrite     dramatic questions, seeds, phases, ending conditions
character/{id}       calibrator            overwrite     base character definitions (traits, voice, layers)
bond/{id}            calibrator            overwrite     base relationship definitions
```

## Agent Prompt Contract

**Universal block (all data-touching agents):**

```
## Data Access

Read and write game data through scripts only. Never read or write
YAML files directly.

Run $SCRIPTS/{script} --help for usage.

Read:  turn-read.sh, campaign-read.sh, game-read.sh
Write: turn-write.sh, campaign-write.sh, game-write.sh
```

**Per-agent blocks** provide artifact-specific guidance: which artifacts the agent writes, which it reads, and what to explore before acting. Prompts describe intent (what content belongs in each artifact), not structure (what keys to use). The schema enforces structure; `--help` documents the interface.

**Manifest changes:** Agents no longer need YAML files listed in their manifest `files` section. Scripts know file locations. Manifests shrink to script references only.

## Self-Documenting Scripts

Each script provides `--help` output that serves as the canonical reference for agents at runtime. Agents that need a reminder call `--help` themselves. This means:

- Schema changes don't require prompt edits
- Agents discover new structure via `--keys` and `--discover`
- The script is the single source of truth for interface details

## Entropy Scripts

`merge-entropy-tables.sh` and `entropy-resolver.sh` are **out of scope** for this design. They produce YAML but have side effects beyond file writing. Separate investigation required.

## Campaign Snapshots

`turns/turn-N/campaign-snapshot/` directories are full state copies created by init-turn for turn redo support. These are file copies, not agent writes. They **bypass the gateway entirely**.

## Single-Writer Invariant

Each artifact has a single writer agent (or writer group for violations). This is enforced by convention via agent prompts, not by the scripts. The scripts do not implement file locking.

## Migration Strategy

**Phase 1 — Build scripts + schemas**
- Build all six scripts and schema files
- Derive schemas from HH production data, correcting known drift
- Scripts work against existing YAML — read scripts parse current format
- Write scripts produce identical output to current agent YAML
- Test: run write scripts against known-good HH turn data, diff against originals
- Restructure arc `seeds_turn_X`/`questions_turn_X` → append-friendly arrays
- Migrate any monolithic `entities.yaml` to per-entity files
- Remove `protagonist.yaml` (merge into `entities/characters/`)

**Phase 2 — Migrate writes (per-agent rollout)**
- Update agent prompts one at a time, simplest first:
  1. violations (Oracle/lint agents)
  2. collisions (Gravity)
  3. context, intent, action-lock, director-notes (init-turn)
  4. fates, dramaturg-notes, threads, pov-resolution, scene-outline (Architect)
  5. entropy-tables, entropy-selection, resolution (Architect)
  6. sim-plan, sim-progress, scene-script (Simulator agents)
  7. visual (Visual)
  8. campaign artifacts (Scribe → campaign-write.sh)
  9. game artifacts (Calibrator → game-write.sh)
- Each migration: one prompt edit + verification on a test turn

**Phase 3 — Migrate reads**
- Update agent prompts to use `*-read.sh` instead of direct file reads
- Context savings: agents query scoped data instead of ingesting whole files
- Per-agent, independent of other agents

**Phase 4 — Retire campaign.sh**
- Once Scribe is fully on campaign-write.sh + campaign-read.sh
- Archive campaign.sh

**Data migration required for Phase 1 only:**
- Arc schema restructure (per-turn dynamic keys → append-friendly arrays)
- Monolithic entities.yaml → per-entity files
- protagonist.yaml → entities/characters/ with `protagonist: true`

All other phases are interface changes only — scripts read/write the same YAML format.

# Narrative Engine v2

LLM-native tabletop RPG system. No stats. No HP. Pure semantic mechanics.

Collapsed single-mesh architecture — all agents in one routing table, no cross-mesh hops.

## Philosophy

Traditional RPGs simulate with numbers: Strength 16, 47 HP, roll d20+modifier.

This system simulates with **meaning**:
- Traits like `[STUBBORN]` or `[WOUNDED]` are interpreted contextually
- Damage becomes trait accumulation (`[BLEEDING]` → `[DYING]`)
- Outcomes emerge from weighted probability tables + external entropy
- Character evolution happens through pressure, not player choice
- Bonds are 12-dimensional (physical, emotional, trust, fear, etc.), not a single number
- Characters have lives — concerns, expertise, opinions, memories — beyond the plot

## Pipeline

```
Player action
    ↓
  entry → init-turn (intent confirmation via HITL)
    ↓
  architect (sonnet)
    Fires parallel blind haiku Tasks:
    ├── Environment (world events)
    ├── Consequences (delayed effects)
    ├── Texture (ambient sensory)
    ├── Thread extraction (per character)
    └── Scene thread extraction
    Then: collision synthesis, per-character outcome tables,
          direction tables, entropy resolution
    Writes: fates.yaml, dramaturg-notes.yaml, entropy-tables.yaml,
            resolution.yaml, threads.yaml
    ↓
  simulator (sonnet)
    Fires parallel blind haiku Tasks per beat:
    ├── table-gen (outcome tables per beat)
    └── npc-voice (character-isolated dialogue)
    Writes: scene_script.yaml (beat-by-beat with voice data)
    ↓
  oracle (sonnet)
    Validates scene_script against Continuity Ladder (13 levels)
    Bond dimension continuity (BOND_BASELINE)
    Routes: approved → narrator, violations → simulator (retry)
    ↓
  narrator (opus)
    Reads scene_script voice data, author.yaml, entity life sections
    Renders prose from beat structure (dialogue verbatim, seeds elaborated)
    Thread-aware, frame-aware, bond-aware rendering
    Writes: prose-draft.md
    Runs: mechanical-lint.sh
    ↓
  lint-patterns → lint-temporal → lint-metaphor (sonnet chain)
    Creative linters requiring judgment (patterns, time, metaphor)
    Routes: violations → editor, clean → scribe
    ↓
  editor (opus, if needed)
    Adversarial prose review against author.yaml
    ↓
  scribe (sonnet)
    Context compression, state promotion, canon updates
    Sends prose to player via core
    ↓
  visual (sonnet, opt-in)
    Multi-beat emotional visualization briefs
```

## Story Creation (Calibrator)

The calibrator is an opus-powered HITL extraction loop that builds a game from conversation. No templates to fill out — it interviews you and crystallizes your answers into game-ready artifacts.

### Two Modes

**New Game** — 9-phase extraction loop that builds everything from scratch:

| Phase | What It Extracts | Writes To |
|-------|-----------------|-----------|
| 1. The Spark | Raw creative impulse — a scene, feeling, image | tone notes |
| 2. World-Bones | Truths that make this world distinct, the lie everyone believes | `setting.yaml` |
| 3. Dramatic Engine | Central tension, questions the world forces characters to answer | `arc.yaml` |
| 4. Peak Moments | 2-3 climactic scenes living in the player's head | `arc.yaml` seeds |
| 5. Endings | Possible termination states (plural), what ending would feel like betrayal | `arc.yaml` endings |
| 6. Who Breathes Here | Characters — identity, psychology, traits, voices, bonds, life sections, hidden past | `entities/` |
| 6c. Authorship | Prose voice — pacing, cadence, dialogue balance, chaos register, interpretive frames. A/B/C style samples rendered and iterated until "yes, that's it" | `author.yaml` |
| 7. Seeds & Mysteries | Strange details that don't fit, mysteries even the player doesn't understand | `arc.yaml` seeds |
| 8. Hard Limits | What breaks this world, off-limits topics, unacceptable endings | `setting.yaml` constraints |
| 9. Confirmation | Summary + handoff to narrator for prologue rendering | — |

**Worldbuilder** — targeted tuning of existing artifacts. Pick an artifact (author, setting, arc, protagonist, entities), see current state, answer targeted questions, see A/B/C variations, confirm changes.

### Character Extraction (Phase 6)

Characters are extracted in layers — each with schema validation:

- **Identity**: name, appearance, visual_tags (10-25 words, no names, image-gen ready)
- **Foundation**: ideology (what they build on), function (why they need it), shadow (what it hides)
- **Psychology**: wound, lie, wants, needs, blind_spot
- **Traits**: 3-5 core traits at pressure 1, each with description/function/shadow
- **Voices**: every trait gets a `speaks_as` — first-person internal monologue, not description
- **Layers**: progressive disclosure (first_glance → familiar → intimate)
- **Life**: active concerns, expertise, social web, opinions, desires beyond plot, voice markers, memories
- **Bonds**: 12-dimensional relationship mapping per character pair
- **Hidden Past** (optional): incident, who knows, pattern connections, narrative implications

The `life` section is what makes characters feel like people rather than relationship-processing machines. Without it, characters orbit each other with nothing to talk about except their feelings.

### Authorship Calibration (Phase 6c)

The most iterative phase. Calibrator:
1. Asks pacing, balance, and dwelling preferences
2. Renders the same opening scene in 2-3 distinct styles
3. Player picks one or blends ("the cadence of A with the interiority of C")
4. Asks about chaos register (how random world events should feel)
5. Optionally defines interpretive frames (narrative lenses that shape texture)
6. Re-renders and iterates until the player says "that's it"

Output is `author.yaml` — the narrator's bible for every turn.

### Mid-Creation Switching

During new-game extraction, the player can say "wait, go back and edit the setting" — calibrator saves state, switches to worldbuilder mode for that artifact, then resumes new-game where it left off.

## Agents

| Agent | Model | Role |
|-------|-------|------|
| **entry** | sonnet | Session router — new game, write turn, resume |
| **game-coord** | sonnet | New game workflow orchestration |
| **init-turn** | sonnet | Workspace creation, intent confirmation (HITL) |
| **calibrator** | opus | Game creation — 9-phase HITL extraction loop (see Story Creation above) |
| **architect** | sonnet | Collapsed entropy pipeline (fates + dramaturg + possibility + system). Parallel blind Tasks for world-gen, inline story shaping, entropy resolution |
| **simulator** | sonnet | Beat-by-beat scene simulation. Blind table-gen and NPC voice Tasks per beat |
| **oracle** | sonnet | Continuity validation (13-level ladder) + knowledge queries |
| **narrator** | opus | Prose rendering from scene_script voice data. Thread/frame/bond-aware |
| **lint-patterns** | sonnet | Creative lint: AI pattern detection |
| **lint-temporal** | sonnet | Creative lint: temporal consistency vs timeline |
| **lint-metaphor** | sonnet | Creative lint: metaphor/sensory channel saturation |
| **editor** | opus | Adversarial prose review against author.yaml |
| **scribe** | sonnet | State compression, canon promotion, campaign updates |
| **visual** | sonnet | Multi-beat emotional visualization briefs |

Mechanical lints (forbidden words, AI tells, cadence, dialogue tags, body-first, litotes) run as `scripts/mechanical-lint.sh` inside the narrator phase — no separate agents.

## Key Concepts

### 12-Dimensional Bonds

Relationships aren't a single intensity number. Each dimension (0-5) tracks independently:
- **Asymmetry**: `{h: 3, k: 1}` — trust isn't always mutual
- **Baseline prose**: What the simulator treats as GIVEN per axis
- **Established moments**: Specific acts with `normalized` vs `new` status
- **Evolution**: Scribe updates dimensions, baseline, and moment log per turn

Bond dimensions create a FLOOR for comfort, not a ceiling for drama. Characters struggle with the frontier, not with ground already covered.

### Life Threads

Characters have lives beyond the plot. The architect extracts threads from entity `life` sections:
- `active_concerns` — deadlines, worries, unresolved problems
- `expertise` — knowledge that surfaces in conversation
- `social_web` — relationships referenced in dialogue
- `opinions` — views that emerge organically
- `memories` — formative moments that surface unbidden

Thread extraction → collision synthesis → direction tables. Threads surface through conversation, not revelation.

### Initiator/Receiver Resolution

Resolution is sequential, not parallel. The POV character (initiator) resolves first. NPC tables are generated knowing what the initiator did — so NPCs respond to reality, not a hypothetical. Overall outcome is distance-weighted 60/40 initiator/receiver.

### Chaos Register

Author-controlled tone for world events. Set in `author.yaml`. Ranges from `mundane` (boring, inconvenient) through `naturalistic` (vivid, life-like) to `farcical` (slapstick, absurdist). Supports single register or weighted blends.

At least half of world events must be genuinely chaotic. The world is not a novelist.

### Trait Pressure

Every time a trait influences an outcome, its pressure increments (1-5). At pressure 5, the trait **evolves**: intensification, transformation, emergence, or fading. Evolution is not player choice — it happens based on how you've been tested.

## File Structure

```
.ai/games/{game-id}/
├── author.yaml              # Authorial voice (per game)
├── setting.yaml             # Immutable world truths
├── arc.yaml                 # Dramatic questions, seeds, phases
├── prologue.md              # Opening prose
├── entities/
│   ├── characters/*.yaml    # Game-level entity templates
│   └── bonds/*.yaml         # Game-level bond templates
│
└── campaigns/{campaign-id}/
    ├── state.yaml           # Current scene state (arc pressure, location, positions)
    ├── continuity.yaml      # Facts that cannot be contradicted
    ├── timeline.yaml        # Canonical time reference
    ├── trajectories.yaml    # Committed futures (Chekhov's Guns)
    ├── quality-log.yaml     # Per-turn quality metrics
    ├── entities/
    │   ├── characters/*.yaml  # Campaign-evolved entities
    │   └── bonds/*.yaml       # Campaign-evolved bonds
    └── turns/turn-{N}/
        ├── intent.yaml          # Player intent decomposition
        ├── action-lock.yaml     # Locked action (inviolable)
        ├── context.yaml         # Scene setup for this turn
        ├── fates.yaml           # World possibility branches
        ├── dramaturg-notes.yaml # Per-character analysis + guidance
        ├── entropy-tables.yaml  # Weighted probability tables
        ├── resolution.yaml      # Entropy-resolved outcomes
        ├── threads.yaml         # Life thread data for this turn
        ├── scene_script.yaml    # Beat-by-beat script with voice data
        ├── prose-draft.md       # Narrator output (pre-edit)
        ├── prose.md             # Final prose (post-edit)
        ├── summary.md           # Compressed turn summary
        ├── visual.yaml          # Visualization briefs
        ├── violations.yaml      # Lint violations log
        └── entropy_tables/      # Per-domain table fragments
            ├── world-env.yaml
            ├── world-consequence.yaml
            ├── texture.yaml
            ├── threads-*.yaml
            ├── collisions.yaml
            ├── char-*.yaml
            └── char-*-directions.yaml
```

## Scripts

All at `scripts/`:

| Script | Used By | Purpose |
|--------|---------|---------|
| `init-workspace.sh` | init-turn | Create turn workspace, snapshot campaign |
| `calc-distribution.sh` | architect | Base weight distribution from arc pressure |
| `calc-trajectory-status.sh` | architect | Bucket trajectories into firing/approaching/active |
| `merge-entropy-tables.sh` | architect | Assemble entropy_tables/ fragments |
| `entropy-resolver.sh` | architect, simulator | Roll against weighted tables (external RNG) |
| `character-brief.sh` | architect, simulator | Information-isolated character brief for blind Tasks |
| `calc-trait-decay.sh` | init-turn | Trait pressure decay between turns |
| `validate-scene-script.sh` | simulator | Structural validation of scene_script.yaml |
| `mechanical-lint.sh` | narrator | Consolidated mechanical lints (forbidden words, AI tells, cadence, etc.) |
| `coordinator-ready.sh` | scribe | Check coordinator readiness |
| `increment-turn.sh` | entry | Advance turn counter |
| `redo-turn.sh` | entry | Reset turn for re-run |
| `snapshot-campaign.sh` | init-workspace | Campaign state snapshot |
| `state-discovery.sh` | config | Discover current pipeline state for recovery |

## Example Games

`example-games/` ships three ready-to-play games. To start one:

```bash
# Copy the game into your workspace
cp -r example-games/frayel-rising .ai/games/frayel-rising
```

Then send a "new campaign" message to `narrative-engine-v2/entry` — or use the calibrator's worldbuilder mode to tune any artifact before playing.

| Game | Genre | Premise |
|------|-------|---------|
| **frayel-rising** | Warm-absurdist sci-fi | A telepathic pilot, her lying ship AI, and the asteroid belt's worst job market. Found family, working-class survival, and a universe with terrible comic timing. |
| **what-sees-you** | Cosmic horror | A graduate archivist, a dead woman's letters, and a presence that emerged from the act of watching itself. |
| **consciousness-bleed** | Near-future dark wonder | Coincidences are becoming statistically impossible, and some humans are more receptive than others. Technology as midwife to human embodiment, not replacement of it. |

Each game includes `author.yaml`, `setting.yaml`, `arc.yaml`, `entities/`, and (where applicable) `prologue.md`. No campaign data — you start fresh.

### Creating Your Own

Run the calibrator (send "new game" to `narrative-engine-v2/entry`) for a guided 9-phase extraction loop that builds all game artifacts from conversation. Or copy an example game and use worldbuilder mode to reshape it.

## Archived

`archive/` contains retired agents from earlier pipeline designs:
- `cast/`, `dialogue/`, `scene-crafter/` — collapsed into simulator
- `fates/`, `dramaturg/`, `possibility/`, `system/` — collapsed into architect
- `render-coord.md`, `validate-coord.md`, `compress-coord.md` — retired coordinators

## How Dialogue Changed from V1

### V1: Linear, Pre-Planned Pipeline

```
CAST (reaction guidance, no actual dialogue)
  → SCENE-CRAFTER (beat structure + scaffold)
    → DIALOGUE (writes ALL dialogue for ALL characters)
      → NARRATOR (weaves pre-written dialogue into prose)
```

The dedicated **DIALOGUE agent** had full narrative visibility — it saw arc pressure, story goals, and both characters' internals. It pre-wrote dialogue for both protagonist and NPCs as structured `dialogue.yaml` with explicit trait-voice annotations and subtext fields before any prose rendering happened.

### V2: Distributed, Entropy-Driven, Information-Isolated

```
SIMULATOR (orchestrates beat-by-beat)
  ├── entropy tables → rolls → beat direction
  ├── NPC-VOICE Task (blind, per character, per beat)
  └── scene_script.yaml → NARRATOR (verbatim rendering)
```

### Key Differences

| Aspect | V1 | V2 |
|--------|----|----|
| **Who writes dialogue** | Dedicated DIALOGUE agent | Distributed NPC-VOICE Tasks |
| **When** | Pre-planned before simulation | Generated per-beat as simulation unfolds |
| **Narrative visibility** | Full — sees arc, story, both characters | Blind — sees only observable context |
| **Protagonist dialogue** | Pre-written alongside NPC lines | Emerges from player action |
| **Entropy** | Weights outcomes before dialogue | Rolls outcomes then generates dialogue from result |
| **Subtext** | Explicitly documented in YAML | Emergent from trait psychology + information barrier |

### Why It Changed

V1 had problems:
1. **Narrative bias** — the DIALOGUE agent could see the full story, so dialogue sometimes served plot instead of character
2. **NPCs knew too much** — information leaked through the pipeline
3. **Locked protagonist** — both sides pre-written before player could influence
4. **Tight coupling** — SCENE-CRAFTER, DIALOGUE, and NARRATOR were interdependent

V2's fix: make voice generation **blind** (only observable context), **just-in-time** (after entropy rolls), and **parallel** (one Task per character per beat). Characters can genuinely surprise each other because they don't know what the other is thinking.

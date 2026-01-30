# Continuity Reference
# Runtime consistency enforcement for narrative-engine
# Load this alongside game state to prevent drift and contradiction

## The Problem

Narrator and CAST are ephemeral. Each spawn has no memory except what's loaded. Convincing errors slip through because:
- Truths established in Turn 5 aren't loaded in Turn 25
- Character voices drift without anchoring
- Constraints get violated when not in immediate context
- Facts get contradicted when not explicitly tracked
- **Entity descriptions repeat** — same details surfaced every appearance

## The Solution: Continuity Oracle

Maintain a **facts-established** file that grows through play and gets loaded as ground truth.

### File: `campaign/continuity.yaml`

```yaml
# continuity.yaml - Facts that CANNOT be contradicted
# Updated after each turn by SYSTEM
# Loaded by NARRATOR and CAST before generating

# World facts established through play
# These are LOCKED - violating them breaks continuity
world_facts:
  # - fact: "The south gate was destroyed in Turn 12"
  #   established: 12
  #   cannot_contradict: "South gate cannot be used, mentioned as intact, etc."

# Character facts established through play
character_facts:
  # moth:
  #   - fact: "Lost her left hand in the escape"
  #     established: 8
  #   - fact: "Revealed her real name: Sera"
  #     established: 15

# Relationship facts
relationship_facts:
  # - fact: "Kael knows Moth's real name"
  #   established: 16
  #   parties: [kael, moth]

# Timeline facts (ordering that can't be violated)
timeline:
  # - event: "The signal first appeared"
  #   turn: 3
  # - event: "First contact with VEIL"
  #   turn: 7
  #   must_follow: "The signal first appeared"

# Dead characters (cannot speak, act, or be present)
dead: []
  # - id: vicar_solen
  #   died: 18
  #   cause: "Executed by Vestry"

# Destroyed/changed locations
location_changes: []
  # - location: south_gate
  #   change: destroyed
  #   turn: 12

# Revealed secrets (no longer secret)
revealed_secrets: []
  # - secret: "The Machine was always speaking"
  #   revealed_to: [cassius, silence, moth]
  #   turn: 22

# Entity encounters - tracks what's been shown to reader/protagonist
# Prevents repetitive descriptions, enables progressive disclosure
encounters: {}
  # moth:
  #   reader_introduced: 3        # turn reader first saw them
  #   protagonist_met: 5          # turn protagonist interacted (if different)
  #   layers_surfaced: [first_glance]
  #   details_revealed:
  #     - detail: "tall, watchful posture"
  #       turn: 3
  #     - detail: "collar-touching habit"
  #       turn: 8
  #   last_appearance: 12
  #
  # the_shop:
  #   reader_introduced: 2
  #   protagonist_visited: [2, 5, 8]    # multiple visits tracked
  #   layers_surfaced: [first_glance, familiar]
  #   details_revealed:
  #     - detail: "copper smell"
  #       turn: 2
  #     - detail: "foreign postcard"
  #       turn: 5
  #   last_appearance: 8
```

## Integration Points

### SYSTEM: After Resolution

After writing `resolution.yaml`, SYSTEM updates `continuity.yaml`:

```yaml
# In resolution.yaml
continuity_updates:
  world_facts:
    - fact: "The seal is now open"
      cannot_contradict: "Seal cannot be described as closed/sealed"
  character_facts:
    jorim:
      - fact: "Voice has returned"
  revealed_secrets:
    - secret: "The hollow was 50 years of unanswered love"
      revealed_to: [cassius, jorim, witnesses]
```

SYSTEM appends these to `campaign/continuity.yaml`.

### NARRATOR: Before Rendering

Before writing prose, NARRATOR loads and checks:

```markdown
## Continuity Check (Before Rendering)

1. Load `campaign/continuity.yaml`
2. Load `campaign/thread.md` (narrative summary)
3. For each element in your draft:
   - Does any description contradict a world_fact?
   - Does any character action contradict their established facts?
   - Is any dead character present or speaking?
   - Is any destroyed location described as intact?
   - Is any revealed secret treated as still hidden?

If contradiction detected:
- Flag it explicitly
- Revise before finalizing
- Log the near-miss for review
```

### NARRATOR: Entity Description (Progressive Disclosure)

Before describing ANY entity (character, location, item, faction):

```markdown
## Encounter Check (Before Describing)

1. Load entity file from `campaign/entities/`
2. Check `encounters` in `campaign/continuity.yaml`
3. Determine disclosure level:
   - Entity NOT in encounters? → First introduction (use first_glance layer)
   - Entity in encounters? → Check layers_surfaced
   - All layers surfaced? → Only describe CHANGES or CONTEXT

4. Draw from appropriate layer:
   - first_glance not surfaced → use first_glance pool
   - first_glance surfaced, familiar not → use familiar pool
   - familiar surfaced, intimate not → use intimate pool (if appropriate)
   - all surfaced → describe only what's NEW (injuries, mood, context)

5. Flag revealed details for SCRIBE to log

CRITICAL: Never repeat a detail from details_revealed.
Fiction is only new information.
```

**Example - Second Meeting:**
```yaml
# Entity: moth
# encounters shows: layers_surfaced: [first_glance]
# details_revealed: ["tall, watchful posture", "calloused hands"]

# WRONG: "The tall woman watched them approach, her calloused hands..."
# RIGHT: "Moth stood at the bar. She touched her collar — a nervous habit."
#        (Draw from familiar layer, don't repeat first_glance details)
```

### CAST: Before Dialogue

Before writing NPC reactions, CAST checks:

```markdown
## Voice Continuity

1. Load character's `voice:` profile from entities.yaml
2. Load character's facts from continuity.yaml
3. For each line of dialogue:
   - Does cadence match profile?
   - Does vocabulary avoid forbidden words?
   - Does register match relationship to speaker?
   - Do emotional tells match the situation?

If voice drift detected:
- Revise to match profile
- Note if profile needs updating (character evolved)
```

### SCRIBE: Layer Evolution

After each turn, SCRIBE updates entity layers based on episodes:

```markdown
## Layer Evolution (After Resolution)

1. For each entity affected by this turn's events:
   - Did something VISIBLE change? → Add to first_glance
   - Did a BEHAVIORAL pattern emerge? → Add to familiar
   - Did an INTERNAL truth manifest? → Add to intimate

2. Layer placement rules:
   - Physical changes (scars, wounds, new clothing) → first_glance
   - Habits, tells, quirks observed → familiar
   - Secrets revealed, fears made visible → intimate

3. Update entity file:
   ```yaml
   layers:
     first_glance:
       - "Existing detail"
       - "Fresh burn scarring up her left arm"  # NEW from turn 14
   ```

4. Update encounters in continuity.yaml:
   - Add entity if first appearance
   - Update last_appearance turn
   - Log any details NARRATOR revealed
```

**Example - Episode Creates New Detail:**
```yaml
# Episode: "Moth was burned escaping the fire"
# Scribe adds to moth's entity file:

layers:
  first_glance:
    - "Tall, moves like someone used to being watched"
    - "Fresh burn scarring up her left arm"  # NEW - visible immediately

# Note: burn goes to first_glance because it's immediately visible,
# even though it happened later chronologically.
```

## The Continuity Ladder

Ordered by priority (higher = harder constraint):

1. **CONSTRAINTS** (setting.yaml) — Absolute. Never violate.
2. **DEAD** (continuity.yaml) — Dead characters stay dead.
3. **WORLD_FACTS** (continuity.yaml) — Established through play.
4. **CHARACTER_FACTS** (continuity.yaml) — What's true about individuals.
5. **TIMELINE** (continuity.yaml) — Event ordering.
6. **TRUTHS** (setting.yaml) — World axioms.
7. **VOICE** (entities.yaml) — Character sound.
8. **ENCOUNTERS** (continuity.yaml) — What's been shown (no repetition).

Lower levels can be revised by author. Higher levels require explicit retcon.

**Note on ENCOUNTERS:** Unlike other constraints, encounters don't prevent actions — they prevent *repeated description*. A character's scar can be referenced, but shouldn't be introduced twice.

## Thread.md Enhancement

`campaign/thread.md` should include a **FACTS LOCKED** section:

```markdown
## Facts Locked (cannot contradict)

- The seal opened in Turn 22
- Jorim's voice returned in Turn 24
- 240 faithful crossed the threshold
- The Cathedral split into two factions
- Unit-Seven removed her helmet publicly

## Recent Events (for context)

[narrative summary...]
```

## Handling Contradictions

When a contradiction is detected:

**During Generation (NARRATOR/CAST):**
```
CONTRADICTION DETECTED:
- Attempted: "Jorim's hollow voice echoed..."
- Established: "Jorim's voice returned" (Turn 24)
- Resolution: Revised to "Jorim's new voice, still uncertain..."
```

**Post-hoc (discovered later):**
```
Option 1: Retcon - explicitly acknowledge the error in-world
Option 2: Revision - treat the contradiction as the error, not the original
Option 3: Fork - this is now a different timeline/playthrough
```

## Validation Prompt (for agents)

Add to NARRATOR and CAST prompts:

```markdown
## Continuity Validation

Before finalizing ANY output:

1. CHECK: Does this contradict any fact in continuity.yaml?
2. CHECK: Does this violate any constraint in setting.yaml?
3. CHECK: Is any dead character alive? Any destroyed thing intact?
4. CHECK: Does character voice match their profile?
5. CHECK: Does any entity description repeat already-revealed details?

If YES to any check:
- STOP
- Identify the contradiction
- Revise before proceeding
- Log the near-miss

Continuity errors are worse than mechanical errors.
A character with the wrong trait is recoverable.
A dead character speaking is not.
Repeated description is not an error — it's wasted prose.
```

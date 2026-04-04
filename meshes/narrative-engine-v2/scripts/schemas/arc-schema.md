# Arc Schema — Canonical Structure for arc.yaml

## Purpose

arc.yaml is the story bible for a campaign. It holds the full dramatic
architecture: acts, escalation rungs, seeds, questions, trajectory.

**arc-read.sh** filters this file before agents see it. Agents only see
current-act context. Future acts, activation conditions, and meta-analysis
are stripped. This document defines the canonical schema that arc-read.sh
expects.

## Top-Level Fields

```yaml
game: string              # Game ID
campaign: string          # Campaign ID
last_updated: datetime    # ISO timestamp
turn_last_updated: int    # Last turn that modified this file
story_day: int            # In-story day number
arc_pressure: int         # 0-100, current dramatic pressure
momentum: string          # "rising" | "falling" | "sustained" | "stalled"
```

## Phase

```yaml
phase:
  current: string         # "Setup" | "Rising" | "Climax" | "Falling" | "Resolution"
  pressure_threshold: int # Pressure needed to advance phase
  next_threshold: int|null
```

## Dramatic Question

```yaml
dramatic_question:
  primary: string         # VISIBLE — the story's driving question
  secondary: string       # VISIBLE — character-level question
  meta: string            # REDACTED — author's thematic thesis
  reader_question: string # REDACTED — what the reader should ask themselves
```

**Rule**: primary + secondary describe what characters experience.
meta + reader_question describe what the author intends. Agents get the former.

## Central Tension

```yaml
central_tension:
  surface: string         # VISIBLE — what characters think the tension is
  deeper: string          # VISIBLE — what it's actually about
  deepest: string         # VISIBLE — the lived experience underneath
  structural: string      # REDACTED — architectural analysis of the engine
```

**Rule**: surface/deeper/deepest are what characters FEEL, even if they
can't articulate it. Structural is what the AUTHOR knows about the
narrative machine. Agents get feelings, not architecture.

## Acts

```yaml
acts:
  I:
    name: string
    status: string        # "in_progress" | "complete" | "dormant"
    objective: string     # What must happen for this act to complete
    summary: string       # What happens in this act
    dramatic_question: string
    current_position: string  # Where we are right now
    ends_when: string     # REDACTED — director knowledge
    seeds_planted: string # REDACTED — meta-commentary
  II:
    status: dormant       # Entire act REDACTED when not in_progress
    ...
```

**Rule**: Only the act with `status: in_progress` is visible to agents.
All other acts are completely invisible. `ends_when` is always stripped
(it tells agents when the act concludes — director knowledge).

**Transition**: When an act completes, set `status: complete` and set
the next act to `status: in_progress`. arc-read.sh auto-adjusts.

## Escalation Ladder

```yaml
escalation_ladder:
  principle: string       # VISIBLE — general guidance
  reader_principle: string # VISIBLE — reader experience (fine for agents)
  structure: string       # Informational, stripped if present

  rung_N:
    name: string
    act: string           # REQUIRED — which act this rung belongs to
    status: string        # "complete" | "active" | "dormant"
    capability: string    # What this rung proves
    principle: string     # How the sex/operation interleave
    scenes_needed:        # List of {name, description} objects
      - name: string
        description: string
    scenes_delivered:     # List of strings (completed scenes)
    established: string   # What's proven after rung completes
    unlocks: string       # What this enables
    bedroom_reward: string
    danger: string
    grandmother: string   # If a G marker lives here
    seeds_to_plant: list  # REDACTED — director stage direction
```

**Rule**: Only rungs where `act` matches the current in_progress act
are visible. `seeds_to_plant` is always stripped.

**Adding rungs**: Every rung MUST have an `act` field. Without it,
arc-read.sh cannot filter correctly.

## Seeds

```yaml
seeds:
  dormant:
    - id: string                  # VISIBLE — unique identifier
      status: string              # VISIBLE — dormant|planted|active|blooming
      note: string                # VISIBLE — what the seed IS (foreshadowing material)
      activation_condition: string # REDACTED — when/how it fires
      earliest_act: string        # Optional — for filtering (not yet enforced)

  planted:
    - id: string
      status: string
      planted_turn: int           # VISIBLE
      note: string                # VISIBLE
      surface_when: string        # VISIBLE — how it manifests (actor knowledge)
      activation_condition: string # REDACTED

  bloomed:
    - id: string
      status: bloomed
      planted_turn: int
      bloomed_turn: int
      note: string                # VISIBLE
```

**Rule**: ALL seeds are visible regardless of status. Seeds ARE
foreshadowing — agents need to see them to weave subtle hints.
But `activation_condition` is always stripped. The agent knows WHAT
to foreshadow, not WHEN or HOW it detonates.

**Writing seed notes**: Seed notes describe the tension or observation,
not the act structure. Avoid: "Activates in Act III" or "This fires
when character X arrives." Use: "Character's talent has been deployed
in another's service. What have they built for themselves?" The note
is what the agent foreshadows. The activation_condition is when the
author detonates it.

## Questions

```yaml
questions:
  - id: string
    question: string        # VISIBLE
    pressure: int           # VISIBLE
    status: string          # "active" | "answered" | "dormant" | "planted"
    note: string            # VISIBLE for active/answered, REDACTED for dormant
    resolution: string      # VISIBLE if present
    resolved_turn: int      # VISIBLE if present
    planted_turn: int       # VISIBLE if present
```

**Rule**: Dormant question notes often reference future mechanics
("V asks and Kaitlin has no answer"). These are stripped. Active
question notes describe current state and are visible.

## Recurring Motifs / Depth Charges

Optional section for recurring narrative elements that surface at
key moments (a character's inner voice, a recurring image, a
thematic callback). Keyed by marker ID, sorted by intended order.

```yaml
recurring_motif:
  principle: string         # VISIBLE — general guidance for when this surfaces
  remaining:
    M1:
      location: string      # REDACTED — placement is director knowledge
      content: string       # VISIBLE (next marker only) — what happens
    M2:
      location: string      # REDACTED
      content: string       # REDACTED (not next)
    M3:
      location: string      # REDACTED
      content: string       # REDACTED (not next)
```

**Rule**: Only the next marker's content is visible. Location is
always stripped. Agents know the motif might surface and roughly
what it would do, but not when or where.

The field name in arc.yaml is flexible (e.g., `grandmother`,
`recurring_dream`, `the_photograph`). arc-read.sh looks for any
top-level key that contains a `remaining` dict with `location` +
`content` sub-keys and applies the same filtering pattern.

## Trajectory

```yaml
trajectory:
  current: string           # VISIBLE — trajectory label
  updated_turn: int         # VISIBLE
  note: string              # VISIBLE — current state description
  volatility: string        # VISIBLE — what's unstable
  critical_threshold: string # REDACTED — what triggers next phase
```

**Rule**: critical_threshold tells agents what's coming. Strip it.
Note and volatility describe what IS, not what WILL BE.

## Agent Levels (--agent flag)

| Agent      | Extra restrictions                                    |
|------------|-------------------------------------------------------|
| default    | Standard filtering as described above                 |
| narrator   | Also strips: arc_pressure, momentum, trajectory       |
| dramaturg  | Standard filtering (full current-act context)         |
| architect  | Also strips: scene descriptions, bedroom_reward       |

Narrator gets the least arc context because it's most susceptible
to "writing toward" pressure targets and thematic conclusions.

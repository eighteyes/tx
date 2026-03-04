# POV Switch Mechanic

## Core Concept

The protagonist isn't special — just whoever's POV we're in. All characters have inner lives (traits, pressures, voices). POV switch moves the camera.

## Triggering a Switch

**Player-initiated:**
```yaml
# In intent.yaml
raw_input: "Switch to {character_b}'s POV"
```

**Story-triggered:**
- Protagonist incapacitated
- Geographic separation (cut to what NPC is doing)
- Interlude structure (chapter breaks)

**Dramaturg-suggested:**
```yaml
# In dramaturg-notes.yaml
pov_switch_available:
  to: character_b
  reason: "Their inner experience of Turn 21 aftermath unrevealed"
  dramatic_value: "Player experiences exhaustion from inside"
```

## Mechanical Changes

### context.yaml

```yaml
turn: 22
context_type: action
pov_character: character_b  # NEW — who we're inside
player_action: "Character B sits against the door, listening"

actor:
  id: character_b
  traits: [EXHAUSTED, BOUNDARIED, MERCURIAL, PERCEPTIVE]
  trait_pressures:
    EXHAUSTED: 5
    BOUNDARIED: 4
    MERCURIAL: 3
    PERCEPTIVE: 2
    WARM: 1

scene:
  location: "Inside apartment, against closed door"
  present: [character_b]
  offscreen: [character_a]  # Original protagonist now offscreen
```

### Entity Flag

```yaml
# {character_b}.yaml during their POV
protagonist: true   # Temporarily true
pov_since: 22       # Track when switch happened

# {character_a}.yaml during Character B's POV
protagonist: false  # Temporarily false
pov_until: 21       # Was protagonist until turn 21
```

### Trait Testing

Character B's traits get tested now:
- EXHAUSTED at 5 = high pressure, likely to dominate
- BOUNDARIED at 4 = walls activated
- Actions against WARM (opening up) are hard

### Inner Voice

Narrator uses Character B's `traits.voices`:

```yaml
# {character_b}.yaml voices become the narration
EXHAUSTED:
  speaks_as: "Twenty turns. Twenty turns of trying..."
BOUNDARIED:
  speaks_as: "The boundary held. The door stays closed."
```

**Prose output:**

> *Twenty turns. Twenty turns of trying to reach them and they yelled ninety seconds after you showed them your hand shaking.* The door is solid against your back. Cool. The boundary held. *It stays closed.*

### World Events (fates.yaml)

Character A becomes NPC. Their trait-driven reactions:

```yaml
world_branches:
  - character_a_pounds_on_door      # DESPERATE: 5 drives this
  - character_a_leaves_silently     # PROTECTIVE: 1 flicker
  - character_a_slides_note_under   # MERCILESS_CLARITY finding words
  - neighbors_call_police           # External consequence
```

Character A's DESPERATE: 5 makes aggressive options more likely. Their traits constrain THEM now.

## What Persists Across POV

| Persists | Resets |
|----------|--------|
| Arc pressure | Actor traits (new character's) |
| World state | Inner voice |
| Trajectories | Action-lock (new character's agency) |
| Continuity | Scene focus |
| Bond states | Trait testing |

## Return Mechanics

### Automatic Return
```yaml
# After N turns, or story trigger
pov_return:
  to: character_a
  trigger: "Scene resolution"
  turn: 24
```

### Player-Initiated
```yaml
action: "Switch back to {character_a}"
```

### Interleave Pattern
```yaml
# campaign/pov-pattern.yaml
pattern: alternating
characters: [character_a, character_b]
switch_on: scene_end
```

## Integration Points

| Agent | POV-Aware Change |
|-------|------------------|
| init-turn | Reads `pov_character` from session, loads correct entity |
| fates | Original protagonist becomes NPC with trait-driven reactions |
| dramaturg | Uses current POV character's traits for outcome shapes |
| possibility | Weights based on current actor's trait pressures |
| narrator | Uses current character's `voices` for inner monologue |

## Example: Turn 22 from Character B's POV

**Player input:** "Stay against the door. Listen for whether they leave."

**Character B's traits tested:**
- EXHAUSTED: 5 — *"Just tired. So tired."*
- BOUNDARIED: 4 — *"The door stays closed."*
- WARM: 1 — flickers when they hear Character A crying (if that happens)

**World events (Character A as NPC):**
- DESPERATE: 5 drives pounding, pleading
- MERCILESS_CLARITY: 6 might produce note slid under door
- PROTECTIVE: 1 might flicker into leaving

**Outcome:** Player experiences what it's like to be exhausted and boundaried while someone with DESPERATE: 5 is on the other side of the door.

## Session Tracking

```yaml
# session.yaml
pov_history:
  - character: character_a
    turns: [0, 21]
  - character: character_b
    turns: [22, ?]
current_pov: character_b
```

## Constraints

- POV character MUST have full entity file (traits, voices, pressures)
- Can't POV-switch to character without inner life defined
- Original protagonist's traits continue evolving offscreen (based on world events)
- Bond is bidirectional — both characters have bond entry for each other

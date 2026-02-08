# POV Switch Mechanic

## Core Concept

The protagonist isn't special — just whoever's POV we're in. All characters have inner lives (traits, pressures, voices). POV switch moves the camera.

## Triggering a Switch

**Player-initiated:**
```yaml
# In intent.yaml
raw_input: "Switch to Heather's POV"
```

**Story-triggered:**
- Protagonist incapacitated
- Geographic separation (cut to what NPC is doing)
- Interlude structure (chapter breaks)

**Dramaturg-suggested:**
```yaml
# In dramaturg-notes.yaml
pov_switch_available:
  to: heather
  reason: "Her inner experience of Turn 21 aftermath unrevealed"
  dramatic_value: "Player experiences exhaustion from inside"
```

## Mechanical Changes

### context.yaml

```yaml
turn: 22
context_type: action
pov_character: heather  # NEW — who we're inside
player_action: "Heather sits against the door, listening"

actor:
  id: heather
  traits: [EXHAUSTED, BOUNDARIED, MERCURIAL, PERCEPTIVE]
  trait_pressures:
    EXHAUSTED: 5
    BOUNDARIED: 4
    MERCURIAL: 3
    PERCEPTIVE: 2
    WARM: 1

scene:
  location: "Inside apartment, against closed door"
  present: [heather]
  offscreen: [kaitlin]  # Original protagonist now offscreen
```

### Entity Flag

```yaml
# heather.yaml during her POV
protagonist: true   # Temporarily true
pov_since: 22       # Track when switch happened

# kaitlin.yaml during Heather's POV
protagonist: false  # Temporarily false
pov_until: 21       # Was protagonist until turn 21
```

### Trait Testing

Heather's traits get tested now:
- EXHAUSTED at 5 = high pressure, likely to dominate
- BOUNDARIED at 4 = walls activated
- Actions against WARM (opening up) are hard

### Inner Voice

Narrator uses Heather's `traits.voices`:

```yaml
# heather.yaml voices become the narration
EXHAUSTED:
  speaks_as: "Twenty turns. Twenty turns of trying..."
BOUNDARIED:
  speaks_as: "The boundary held. The door stays closed."
```

**Prose output:**

> *Twenty turns. Twenty turns of trying to reach her and she yelled BITCH ninety seconds after you showed her your hand shaking.* The door is solid against your back. Cool. The boundary held. *It stays closed.*

### World Events (fates.yaml)

Kaitlin becomes NPC. Her trait-driven reactions:

```yaml
world_branches:
  - kaitlin_pounds_on_door      # DESPERATE: 5 drives this
  - kaitlin_leaves_silently     # PROTECTIVE: 1 flicker
  - kaitlin_slides_note_under   # MERCILESS_CLARITY finding words
  - neighbors_call_police       # External consequence
```

Kaitlin's DESPERATE: 5 makes aggressive options more likely. Her traits constrain HER now.

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
  to: kaitlin
  trigger: "Scene resolution"
  turn: 24
```

### Player-Initiated
```yaml
action: "Switch back to Kaitlin"
```

### Interleave Pattern
```yaml
# campaign/pov-pattern.yaml
pattern: alternating
characters: [kaitlin, heather]
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

## Example: Turn 22 from Heather's POV

**Player input:** "Stay against the door. Listen for whether she leaves."

**Heather's traits tested:**
- EXHAUSTED: 5 — *"Just tired. So tired."*
- BOUNDARIED: 4 — *"The door stays closed."*
- WARM: 1 — flickers when she hears Kaitlin crying (if that happens)

**World events (Kaitlin as NPC):**
- DESPERATE: 5 drives pounding, pleading
- MERCILESS_CLARITY: 6 might produce note slid under door
- PROTECTIVE: 1 might flicker into leaving

**Outcome:** Player experiences what it's like to be exhausted and boundaried while someone with DESPERATE: 5 is on the other side of the door.

## Session Tracking

```yaml
# session.yaml
pov_history:
  - character: kaitlin
    turns: [0, 21]
  - character: heather
    turns: [22, ?]
current_pov: heather
```

## Constraints

- POV character MUST have full entity file (traits, voices, pressures)
- Can't POV-switch to character without inner life defined
- Original protagonist's traits continue evolving offscreen (based on world events)
- Bond is bidirectional — both characters have bond entry for each other

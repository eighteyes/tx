# Narrative Engine

LLM-native tabletop RPG system. No stats. No HP. Pure semantic mechanics.

## Philosophy

Traditional RPGs simulate with numbers: Strength 16, 47 HP, roll d20+modifier.

This system simulates with **meaning**:
- Traits like `[STUBBORN]` or `[WOUNDED]` are interpreted contextually
- Damage becomes trait accumulation (`[BLEEDING]` → `[DYING]`)
- Outcomes emerge from weighted probability tables + external entropy
- Character evolution happens through pressure, not player choice

## Architecture

```
Player ──→ NARRATOR ──→ SYSTEM ──→ (outcome table + RNG)
              │              │
              │              ↓
              ├───── CAST ←──┘
              │        │
              ↓        ↓
           (synthesize prose)
              │
              ↓
           Player
```

### Agents

| Agent | Role | Model |
|-------|------|-------|
| **SYSTEM** | Mechanics engine. Generates outcome tables, tracks state, never speaks to player | sonnet |
| **NARRATOR** | Player's window. Orchestrates, renders prose, maintains atmosphere | opus |
| **CAST** | NPC ensemble. Character voices, secrets, lies, motivations | sonnet |

## Game vs Campaign

**Game** = template, world, unchanging truths
**Campaign** = playthrough with evolving state, history, divergence

```
.ai/games/{game-id}/
├── entities.yaml          # Template (starting state)
├── setting.yaml           # Immutable world truths
├── arc.yaml               # Starting arc
│
└── campaigns/
    ├── run-001/
    │   ├── state.yaml     # Current snapshot
    │   ├── entities.yaml  # EVOLVED entities
    │   ├── arc.yaml       # CURRENT arc state
    │   └── history.md     # What happened
    └── run-002/           # Different choices
```

## Starting a Game

1. Create game directory with templates:
```bash
mkdir -p .ai/games/{game-id}/campaigns
cp meshes/narrative-engine/templates/*.yaml .ai/games/{game-id}/
```

2. Edit the template yaml files:
   - `entities.yaml` - Define player character and NPCs
   - `setting.yaml` - World truths, constraints, atmosphere
   - `arc.yaml` - Initial dramatic questions

3. Send message to mesh to start campaign:
```
Start new campaign: {game-id}
```

4. SYSTEM initializes campaign, NARRATOR renders opening scene

## Campaign Commands

| Command | Effect |
|---------|--------|
| `new game` | Initialize fresh campaign from templates |
| `resume` / `continue` | Load last campaign state |
| `resume run-002` | Load specific campaign |
| `fork` / `what if` | Branch current campaign |
| `list campaigns` | Show all playthroughs |

## Game Loops

### Small Loop (per action)
```
Intent → SYSTEM generates table → RNG selects → Render → state shift
```

### Medium Loop (per scene)
```
Dramatic question activates
    ↓
[Small loops accumulate]
    ↓
Momentum threshold breaks
    ↓
Scene resolves: Yes / No / Yes-But / No-And
    ↓
Consequences: bonds shift, questions spawn, traits strain
```

### Large Loop (per arc)
```
Major question looms
    ↓
[Medium loops compound]
    ↓
Arc pressure peaks (80+)
    ↓
TRAIT EVOLUTION:
  - [NAIVE] → [CYNICAL]
  - [BRAVE] → [RECKLESS]
  - Gain: [HAUNTED]
  - Fade: [OPTIMISTIC]
    ↓
World state shifts permanently
```

## Trait System

Traits are semantic modifiers, not numeric bonuses:

| Trait | Helps | Hurts | Depends |
|-------|-------|-------|---------|
| `[STUBBORN]` | Resist intimidation | Negotiation | Stubbornness can be virtue or flaw |
| `[WOUNDED]` | Evoke sympathy | Physical action | Severity matters |
| `[SILVER-TONGUED]` | Persuasion | Being believed when sincere | History catches up |

### Trait Pressure

Every time a trait influences an outcome, its pressure counter increments.

At pressure 5, the trait **evolves**:
- **Intensification**: `[ANGRY]` → `[WRATHFUL]`
- **Transformation**: `[NAIVE]` → `[CYNICAL]`
- **Emergence**: Gain new trait from experience
- **Fading**: Unused traits wither away

Evolution is NOT player choice. It happens based on how you've been tested.

### Consequences as Traits

Harm doesn't subtract HP. It adds traits:
- Arrow wound → `[BLEEDING]`
- `[BLEEDING]` + no treatment → `[DYING]`
- `[DYING]` + failed scene → death (narrative collapse)

These consequence traits affect all future outcome tables.

## Outcome Tables

Generated JIT (just-in-time) for each action:

```
Action: sneak past the guard
Actor traits: [CLUMSY] [DESPERATE] [KNOWS-THE-LAYOUT]

Outcomes:
  70% - succeed messily (noise, but through)
  20% - caught, but with advantage
  10% - clean ghost

Entropy: 67 → succeed messily
```

External RNG (not LLM choice) determines which possibility becomes canon.

## The Zork-Into-Any-Book Mode

To drop into an existing literary world:

1. Set `source.title` in setting.yaml
2. Define which characters become NPCs (with hidden motivations)
3. Choose divergence point (where does this story become yours?)
4. Play from there - the mesh maintains consistency with source material while allowing emergence

Example: Drop into Gatsby's party. The mesh knows the plot. You don't. Make everything worse.

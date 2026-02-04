# Core Experience Definition
# Narrative Engine — Game Design Analysis Phase 1

## Lens of Essential Experience

### The Core Fantasy
**"Inhabit a story where you have agency but not authorship."**

Players don't write the story — they live it. They influence events but don't control outcomes. The system functions as the physics of a narrative universe: things happen TO you as much as you make them happen.

This is the experience of being a character in a novel you haven't read yet.

### Key Emotional States

| State | Source | Mechanic |
|-------|--------|----------|
| **Consequential uncertainty** | External entropy determines outcomes | Player can't predict results, but neither can the AI |
| **Discovered identity** | Trait evolution through pressure | You don't choose who you become; experience shapes you |
| **Meaningful constraint** | ORACLE continuity enforcement | The world remembers; you can't take things back |
| **Authorial helplessness** | JIT outcome tables | Multiple valid futures existed; only one became canon |

### What This Is NOT

- **Not power fantasy**: You're not optimizing a build toward dominance
- **Not choose-your-own-adventure**: Branching paths, but outcomes within paths are uncertain
- **Not collaborative storytelling**: You don't negotiate with the GM; the physics just work
- **Not simulation**: No attempt at realistic probability; dramatic weight matters more

### Differentiation from Traditional TTRPGs

| Traditional RPG | Narrative Engine |
|-----------------|------------------|
| Numeric stats (STR 16) | Semantic traits ([STUBBORN]) |
| Modifiers affect probability | Context determines trait meaning |
| Player chooses level-up | Pressure forces evolution |
| HP as health pool | Consequences as traits ([WOUNDED] → [DYING]) |
| GM narrates | NARRATOR renders; SYSTEM resolves; ORACLE validates |
| Dice you roll | Entropy provided externally (no player ritual) |

---

## Lens of Elemental Tetrad

### Mechanics
The genuinely novel layer:

1. **Semantic Trait Interpretation**
   - Same trait means different things in different contexts
   - [STUBBORN] helps resist intimidation, hurts negotiation
   - No fixed mechanical value; meaning is computed per-situation

2. **JIT Probability Tables**
   - SYSTEM generates 3-5 weighted outcomes before entropy is applied
   - Transparency: player can see "what could have happened"
   - Weights emerge from trait analysis, not lookup tables

3. **External Entropy**
   - Random number comes from outside the LLM
   - Neither player nor AI controls which future becomes canon
   - Creates genuine uncertainty (no narrative convenience)

4. **Trait Pressure & Evolution**
   - Every trait use increments pressure counter
   - At threshold (5), trait evolves: [NAIVE] → [CYNICAL]
   - Evolution is NOT player choice; it's forced transformation
   - Identity is discovered, not authored

5. **ORACLE Gate**
   - Continuity enforcement via adversarial validation
   - Dead stay dead, destroyed stays destroyed
   - Catches "convincing nonsense" (forensic claims that fail physics)
   - Nothing reaches player without approval

### Story
Emergent, not authored:

- **Arc Questions**: Dramatic tensions with pressure counters
- **NPC Motivations**: CAST knows secrets, lies when it serves them
- **Discovery Through Play**: Base game world refined by campaign truths
- **No Plot Armor**: External entropy can kill protagonists

The story is what happens when:
- Player intent meets character capability
- Mechanical resolution meets NPC reaction
- Accumulated consequences meet arc pressure threshold

### Aesthetics

- **Prose Rendering**: NARRATOR transforms mechanics into sensory, atmospheric text
- **Voice Profiles**: Each NPC has distinct speech patterns, cadence, vocabulary
- **Visual Blocks**: CLIP/T5-XXL optimized scene descriptions for image generation
- **Atmospheric Consistency**: Setting defines tone; all output maintains it

### Technology

The multi-agent architecture:

```
Player → NARRATOR → SYSTEM → (resolution)
              ↓         ↓
           ORACLE ← CAST
              ↓
           Player
```

| Agent | Model | Role |
|-------|-------|------|
| NARRATOR | opus | Orchestration, prose, player interface |
| SYSTEM | sonnet | Mechanics, probability, state |
| CAST | sonnet | NPC voices, secrets, lies |
| ORACLE | haiku | Continuity validation, gating |

**State Persistence:**
- Session state: `.ai/tx/narrative-engine/session.yaml`
- Game state: `.ai/games/{game}/campaigns/{campaign}/`
- Turn workspaces: Structured YAML files, not message blobs

---

## Lens of Holographic Design

### Does Each Element Contain the Whole?

**Test Case: The Trait [STUBBORN]**

| Aspect | How [STUBBORN] Contains It |
|--------|---------------------------|
| Semantic interpretation | Helps resist intimidation, hurts negotiation — context-dependent |
| Pressure accumulation | Each use increments counter toward evolution |
| Forced transformation | At pressure 5, becomes [DEFIANT] or [INFLEXIBLE] |
| Consequence stacking | Stubbornness in wrong context adds new negative traits |
| ORACLE enforcement | If character was established as stubborn, they can't suddenly be pliable |

A single trait demonstrates the entire philosophy:
- Meaning over numbers
- Pressure over choice
- Transformation over optimization
- Consistency over convenience

### Test Case: A Single Turn

```
Player: "I try to convince the guard"
```

In this one action:
- NARRATOR interprets intent, notes context
- SYSTEM generates weighted outcome table from semantic traits
- External entropy selects which possibility becomes canon
- CAST provides guard's voice and hidden motivations
- ORACLE validates the prose doesn't contradict established facts
- Trait pressure increments; arc pressure shifts
- Consequences may accumulate

The whole system fires on every single turn.

---

## Core Experience Summary

**What players should feel:**
> "I am living a story I don't control. My choices matter but fate has a vote. I am becoming someone, not building someone. The world remembers what I've done."

**What makes this unique:**
1. Semantic rather than numeric mechanics
2. Identity discovered through pressure, not chosen
3. External entropy removes narrative convenience
4. Adversarial continuity enforcement creates consequence
5. Multi-agent synthesis creates emergent complexity

**The load-bearing innovation:**
The separation of concerns — mechanics (SYSTEM), voice (CAST), rendering (NARRATOR), validation (ORACLE) — allows each to excel at its domain while combining into something none could achieve alone.

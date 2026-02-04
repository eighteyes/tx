# Player Psychology
# Narrative Engine — Game Design Analysis Phase 2

## Lens of Fun

### Primary Fun Sources

| Source | Mechanic | Emotion |
|--------|----------|---------|
| **Anticipation** | Outcome table generates before entropy applies | "Which future will become real?" |
| **Discovery** | Trait evolution through pressure | "Who am I becoming?" |
| **Dramatic irony** | CAST knows secrets player doesn't | "I suspect they're lying..." |
| **Consequence cascade** | Continuity tracking + ORACLE | "That choice echoed forward" |
| **World coherence** | ORACLE catches impossibilities | "This place is real" |

### Bartle Taxonomy Fit

| Type | Fit | Why |
|------|-----|-----|
| **Explorers** | Primary | Discovering story, character, and possibility space |
| **Achievers** | Partial | Arc completion exists, but nothing to optimize |
| **Socializers** | Weak | Single-player, but NPCs have genuine depth and secrets |
| **Killers** | Poor | System dominates back; you can't "win" against it |

**Design Implication**: The target audience is players who find joy in discovery, not dominance. Those who want to build optimal characters will bounce off hard.

### Fun Failure Modes

| Risk | Cause | Mitigation |
|------|-------|------------|
| **Learned helplessness** | Entropy consistently punishes | Trait weighting should favor messy success |
| **Agency collapse** | Evolution feels arbitrary | Pressure visible; evolution thematically coherent |
| **Resonance failure** | Arc questions don't hook | Player input on initial arc questions |
| **Cognitive overload** | Too many systems visible at once | NARRATOR abstracts mechanics into prose |

---

## Lens of Curiosity

### What Players Wonder About

1. **Identity Trajectory**
   - "What will I become?"
   - Trait pressure is visible, but evolution direction isn't
   - Creates anticipatory curiosity about self

2. **NPC Interiority**
   - "What do they know that I don't?"
   - CAST holds secrets; every NPC might be hiding something
   - Creates investigative curiosity about others

3. **Roads Not Taken**
   - "What could have happened?"
   - entropy-tables.yaml exposes the counterfactual
   - Creates reflective curiosity about possibility

4. **World Rules**
   - "What does this universe permit?"
   - ORACLE rejections reveal boundaries
   - Creates exploratory curiosity about physics

### Curiosity Sustaining Mechanisms

| Mechanism | How It Works |
|-----------|--------------|
| **Partial revelation** | Secrets revealed gradually, not dumped |
| **Consequence delay** | Actions echo turns later (continuity tracking) |
| **Trait evolution mystery** | Pressure visible, but transformation direction unknown |
| **Multiple campaigns** | Different runs reveal different truths about base game |

### Exploration Space

The player explores a **probability forest**:
- Each turn has 3-5 possible outcomes
- Each outcome branches into new possibility spaces
- Player only sees the path they walked
- entropy-tables.yaml shows glimpses of adjacent paths

This creates the feeling of a vast world, only partially visible.

---

## Lens of Surprise

### Sources of Meaningful Surprise

| Source | Example | Emotional Payload |
|--------|---------|-------------------|
| **Entropy selection** | Expected clean success, got messy | "Fate had other plans" |
| **Messy success** | Goal achieved, but price paid | "Be careful what you wish for" |
| **Trait evolution** | [PROTECTIVE] → [POSSESSIVE] | "When did I become this?" |
| **NPC revelation** | Trusted ally has been lying | "I should have known" |
| **Arc pressure break** | Question answered unexpectedly | "It was never about that" |

### Surprise vs. Frustration

**What makes surprise feel FAIR:**
- Outcome tables show weighted possibilities (you knew the risk)
- Trait pressure accumulates visibly (evolution isn't sudden)
- Continuity enforcement proves world coherence (not arbitrary)
- Consequences flow from player actions (not random punishment)

**What makes surprise feel CHEAP:**
- Entropy always rolls worst case (bad luck spiral)
- Evolution contradicts character's established identity
- NPCs lie without any foreshadowing
- Arc resolves through deus ex machina

### Surprise Management

```
ACCEPTABLE:
- You failed because your [CLUMSY] trait made the outcome table unfavorable
- NPC betrayed you, but they'd been acting strange (CAST planted tells)
- Trait evolved, but in a direction coherent with pressure history

UNACCEPTABLE:
- Random bad outcome with no trait justification
- NPC betrayal with no prior signals
- Trait evolution that contradicts established behavior
```

**ORACLE's role in surprise**: By enforcing continuity, ORACLE ensures surprise comes from *revelation of hidden truth*, not *contradiction of established truth*. Surprise feels earned, not arbitrary.

---

## Lens of Wonder

### Wonder Sources

| Source | Mechanism | Feeling |
|--------|-----------|---------|
| **Emergent synthesis** | Four agents combine output | "No one authored this" |
| **Character becoming** | Pressure shapes identity | "I didn't choose this, but it's true" |
| **World depth** | Continuity enforcement | "This place remembers" |
| **Prose transcendence** | NARRATOR renders beautifully | "That was genuinely moving" |
| **Counterfactual glimpse** | Seeing entropy-tables.yaml | "So many stories died" |

### The Specific Awe of Multi-Agent Synthesis

When a turn resolves:
- NARRATOR interpreted the player's intent
- SYSTEM generated weighted possibilities
- Entropy selected one future from many
- CAST gave voice to NPCs who might be lying
- ORACLE verified nothing broke the world

No single author created this. The scene emerged from the interaction of specialized agents. When it works, the player experiences something that feels *found*, not *made*.

### Wonder Threats

| Threat | How It Kills Wonder |
|--------|---------------------|
| **Seam visibility** | Player sees the YAML, not the world |
| **Pattern recognition** | "Oh, it always does messy success" |
| **Tone breaks** | Jarring prose that shatters immersion |
| **Mechanical cynicism** | Player starts gaming trait pressure |

### Wonder Protection

1. **NARRATOR as Abstraction Layer**
   - Mechanics exist, but player sees prose
   - Transparency is optional (rearmatter)
   - Immersion is default

2. **ORACLE as Consistency Guardian**
   - Impossible things get caught
   - World feels coherent
   - Coherence sustains belief

3. **Variance in Outcome Tables**
   - Weights shift with context
   - Same action, different situation, different possibilities
   - Prevents pattern formation

---

## Player Psychology Summary

**Primary Audience**: Explorers seeking discovered identity, not optimized identity

**Core Emotions**:
- Anticipation (what will entropy choose?)
- Discovery (who am I becoming?)
- Consequential anxiety (the world remembers)
- Wonder (something emerged that no one authored)

**Key Psychological Design**:
- Curiosity sustained through partial revelation
- Surprise feels fair because outcomes are weighted, not random
- Wonder protected through prose abstraction and continuity enforcement
- Fun persists because agency matters, even when outcomes don't obey

**Unique Psychological Hook**:
> You are exploring who you become under pressure. The character you discover isn't the character you designed. Identity is a mystery you solve by living it.

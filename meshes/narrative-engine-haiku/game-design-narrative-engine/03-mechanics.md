# Mechanics & Systems
# Narrative Engine — Game Design Analysis Phase 3

## Lens of Problem Solving

### What Problems Do Players Solve?

| Problem Type | Description | System Engagement |
|--------------|-------------|-------------------|
| **Tactical** | How do I leverage my traits for this action? | Frame actions to invoke favorable traits |
| **Strategic** | Which arcs should I push toward resolution? | Choose actions that pressure specific questions |
| **Social** | What are NPCs really after? | Read dialogue for lies, infer from behavior |
| **Identity** | Who do I want to become? | Manage which traits accumulate pressure |
| **Narrative** | What story am I trying to live? | Overall intentionality about arc engagement |

### The Non-Optimization Problem Space

Traditional RPGs present optimization problems:
- "What stat allocation maximizes damage output?"
- "Which feat tree gives best synergy?"

This system explicitly **prevents optimization**:
- Traits have contextual meaning (can't calculate fixed value)
- Pressure accumulates whether you want it or not
- Evolution direction isn't player-controlled
- External entropy defeats prediction

**The actual problem**: Navigate consequence, not maximize output.

### Problem-Solving Skill Expression

| Skill | How It Works |
|-------|--------------|
| **Action framing** | Describing action to invoke favorable trait interpretation |
| **Context awareness** | Knowing when [STUBBORN] helps vs. hurts |
| **Pressure management** | Choosing which traits to test (knowing they'll evolve) |
| **NPC reading** | Detecting lies, inferring hidden motivations |
| **Arc awareness** | Understanding which actions pressure which questions |

**Example of skilled play:**
> Player has [SILVER-TONGUED] and [DESPERATE]. Instead of "I persuade the guard," they say "I appeal to the guard's sense of duty, masking my desperation with calm authority."
>
> This framing invokes SILVER-TONGUED strongly while potentially neutralizing the penalty of DESPERATE. Skilled players shape context to shape weights.

---

## Lens of Meaningful Choices

### Choice Categories

| Choice | Impact | Reversibility |
|--------|--------|---------------|
| **Action selection** | Determines which traits get weighted | Low (turn resolves) |
| **Approach framing** | Shapes trait interpretation | Low (frame locks) |
| **Arc engagement** | Determines which questions pressure | Medium (can shift focus) |
| **NPC relationship** | Bonds shift through interaction | Low (history accumulates) |
| **Evolution acceptance** | How you respond to becoming | None (evolution is forced) |

### The Irreversibility Design

Most choices in this system are **low reversibility**:
- Traits tested can't be un-tested
- Pressure accumulated can't be released
- Consequences added can't be removed
- History written can't be unwritten
- ORACLE enforces: the past happened

**Design intention**: Choices matter BECAUSE they can't be taken back. The weight comes from permanence.

### False Choice Risks

| Risk | Cause | Mitigation |
|------|-------|------------|
| **Entropy dominance** | Random roll matters more than choice | Trait weighting heavily shapes distribution |
| **Illusion of framing** | Framing doesn't actually affect weights | SYSTEM must genuinely reinterpret based on framing |
| **Arc railroading** | Questions resolve regardless of player focus | Player can spawn new questions, defer existing ones |
| **Forced evolution** | Evolution feels arbitrary | Evolution direction coherent with pressure history |

### The Core Meaningful Choice

> "Given who I am (traits) and where I am (context), what do I attempt, and how do I frame that attempt to best express the traits I want to invoke?"

This is the fundamental skill loop. Everything else cascades from this.

---

## Lens of Challenge

### Challenge Sources

Unlike traditional difficulty (harder enemies, tighter timers), challenge here comes from:

| Source | How It Works |
|--------|--------------|
| **Consequence accumulation** | Negative traits stack; each wound makes future harder |
| **Arc pressure inevitability** | Questions WILL resolve; you can't defer forever |
| **Trait evolution** | You might not like who you're becoming |
| **NPC complexity** | They have agendas that oppose yours |
| **Continuity weight** | Past actions constrain future possibilities |

### The Pressure Curve

```
Early Game:
- Few traits, low pressure
- Outcomes skew favorable
- World is fresh, possibilities open

Mid Game:
- Traits accumulating, pressure building
- Consequences stacking
- Some traits approaching evolution
- Arc questions becoming urgent

Late Game:
- Multiple evolved traits
- Significant consequence weight
- Arc questions resolving
- Identity substantially determined
- Stakes at maximum
```

### Challenge vs. Difficulty

| Traditional "Difficulty" | This System's "Challenge" |
|--------------------------|---------------------------|
| Enemies hit harder | Consequences accumulate faster |
| Resources scarcer | Favorable traits under more pressure |
| Time limits tighter | Arc questions more urgent |
| Puzzles more complex | NPC motivations more opaque |

**Key insight**: Challenge escalates naturally through play. No difficulty slider needed — the system self-escalates through consequence accumulation.

### Death and Failure

Failure isn't "game over" — it's transformation:
- Physical harm adds traits: [WOUNDED] → [BLEEDING] → [DYING]
- Social harm adds traits: [DISTRUSTED] → [OUTCAST]
- Psychological harm adds traits: [SHAKEN] → [TRAUMATIZED]

Death occurs when consequence traits overwhelm the character's ability to function. It's not hit points reaching zero; it's narrative collapse.

---

## Lens of Skill vs. Chance

### The Balance Point

```
Skill Expression:
├── Action selection (which traits to invoke)
├── Approach framing (how to contextualize traits)
├── Pressure management (which traits to test)
├── NPC reading (detecting lies and motivations)
└── Arc awareness (understanding question pressure)

Chance Expression:
├── Entropy selection (which weighted outcome occurs)
└── NPC secrets (what they're actually hiding)
```

### How Skill Shapes Chance

The **weighting IS the skill expression**:

```
Unskilled play:
Player: "I try to sneak past."
Traits: [CLUMSY]
Outcome table: 60% fail, 30% messy, 10% clean
Entropy: 45 → fail

Skilled play:
Player: "I wait for the patrol to pass, then move through the
        shadows along the wall I know from childhood."
Traits: [CLUMSY] [KNOWS-THE-LAYOUT]
Outcome table: 40% fail, 40% messy, 20% clean
Entropy: 45 → messy success
```

Same entropy roll. Different outcome. Skill shaped the distribution.

### Fairness Perception

| Factor | Why It Feels Fair |
|--------|-------------------|
| **Visible weights** | entropy-tables.yaml shows probabilities |
| **Trait rationale** | SYSTEM explains why traits helped/hurt |
| **Counterfactual access** | Player sees what could have happened |
| **External entropy** | Neither player nor AI rigged the roll |

The transparency of the outcome table is crucial. Players accept bad outcomes when they can see they were weighted possibilities, not arbitrary punishment.

### The Entropy Philosophy

External entropy serves multiple purposes:
1. **Genuine uncertainty**: Even the AI doesn't know what will happen
2. **Fairness perception**: No narrative convenience; dice don't lie
3. **Surprise generation**: System can surprise itself
4. **Author removal**: Story emerges, isn't authored

---

## Mechanics Summary

### The Core Loop

```
┌─────────────────────────────────────────────────┐
│ 1. Player describes action and approach        │
│ 2. SYSTEM interprets traits in context         │
│ 3. SYSTEM generates weighted outcome table     │
│ 4. External entropy selects outcome            │
│ 5. Consequences applied (traits, pressure)     │
│ 6. CAST reacts (NPCs respond)                  │
│ 7. ORACLE validates (continuity holds)         │
│ 8. NARRATOR renders (prose reaches player)     │
└─────────────────────────────────────────────────┘
```

### Mechanical Innovation Points

1. **Semantic trait interpretation** (no fixed values)
2. **JIT probability generation** (no lookup tables)
3. **External entropy** (author-less resolution)
4. **Pressure-based evolution** (forced transformation)
5. **Adversarial continuity** (world that remembers)
6. **Multi-agent synthesis** (emergent complexity)

### Design Elegance

The system achieves something unusual:
- **Skill matters** (framing shapes weights)
- **Chance matters** (entropy selects outcomes)
- **Neither dominates** (skill shapes what chance chooses from)

This is the sweet spot: player agency is real but not complete, creating consequential uncertainty without helplessness.

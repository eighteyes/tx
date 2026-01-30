# Implementation Priorities
# Narrative Engine — Game Design Analysis Phase 6

## Core Loop Definition

### 30-Second Loop (Single Action)
```
Player describes action
    ↓
NARRATOR interprets, frames context
    ↓
SYSTEM generates weighted outcome table
    ↓
Entropy selects outcome
    ↓
CAST provides NPC reactions
    ↓
ORACLE validates
    ↓
NARRATOR renders prose
    ↓
Player receives result + options
```

**Target time**: 15-30 seconds per action
**Current risk**: Multi-agent latency

### 5-Minute Loop (Scene)
```
Dramatic question activates
    ↓
[Multiple action loops]
    ↓
Momentum builds/releases
    ↓
Scene resolves: Yes/No/Yes-But/No-And
    ↓
Consequences: traits pressured, bonds shift
    ↓
Thread updated
    ↓
New scene or arc pressure check
```

**Target time**: 3-7 minutes per scene
**Key metric**: Does momentum feel earned?

### 30-Minute Loop (Arc Question)
```
Major question looms over multiple scenes
    ↓
[Scene loops accumulate pressure]
    ↓
Arc pressure peaks (80+)
    ↓
Trait evolution triggers
    ↓
Question resolves
    ↓
World state shifts
    ↓
New questions spawn
```

**Target time**: 20-40 minutes per arc
**Key metric**: Does resolution feel consequential?

---

## Minimum Viable Game

### What's Required for First Playtest

**Must Have:**
- [ ] NARRATOR handles player input, orchestrates agents
- [ ] SYSTEM generates outcome tables from traits + context
- [ ] SYSTEM applies entropy, returns resolution
- [ ] NARRATOR renders prose response
- [ ] Session state persists across turns
- [ ] Single game with 3-5 characters
- [ ] One dramatic arc question

**Can Defer:**
- [ ] CAST (NARRATOR can simulate NPC voice initially)
- [ ] ORACLE (continuity violations rare in short tests)
- [ ] Trait evolution (need many turns to trigger)
- [ ] Multi-campaign support
- [ ] Visual generation blocks

### MVG Scope

**Game**: A single encounter with clear dramatic question
**Characters**: 3-5 with defined traits
**Duration**: 5-10 turns
**Success metric**: Player reports "my choices felt meaningful"

---

## Risk Assessment

### Risks to Fun

| Risk | Likelihood | Severity | Mitigation |
|------|------------|----------|------------|
| **SYSTEM interprets inconsistently** | High | High | Extensive prompt examples, calibration |
| **Entropy feels punishing** | Medium | High | Weight toward messy success |
| **Latency breaks immersion** | Medium | Medium | Parallel processing, progress indicators |
| **Cognitive overload** | Medium | Medium | Abstract mechanics into prose |
| **Evolution feels arbitrary** | Medium | High | Foreshadowing, thematic coherence |
| **NPCs feel flat** | Medium | Medium | Richer CAST prompt, more secrets |
| **ORACLE blocks valid creativity** | Low | High | Tune thresholds, add uncertainty category |

### Technical Risks

| Risk | Likelihood | Severity | Mitigation |
|------|------------|----------|------------|
| **Multi-agent coordination fails** | Low | High | Explicit state machine, session.yaml |
| **State corruption** | Low | High | YAML validation, backup on write |
| **Context window overflow** | Medium | Medium | Turn workspace isolation, thread.md |
| **Model inconsistency** | Medium | Medium | Pinned model versions, calibration |

### Playtest Risks

| Risk | Likelihood | Severity | Mitigation |
|------|------------|----------|------------|
| **Players don't understand system** | Medium | Medium | Onboarding prose, tutorial scene |
| **Players try to optimize** | Medium | Low | Gentle messaging about philosophy |
| **Players feel helpless** | Medium | High | Ensure skill expression in framing |

---

## Next Steps

### Immediate (This Week)

1. **Calibrate SYSTEM trait interpretation**
   - Add 10+ examples to prompt
   - Test same action, different contexts
   - Verify consistent reasoning

2. **Run 5-turn playtest**
   - Single player, controlled environment
   - Track: latency, trait weightings, player satisfaction
   - Collect: qualitative feedback

3. **Measure ORACLE accuracy**
   - Inject 10 known violations
   - Inject 10 valid edge cases
   - Target: 95% catch rate, <5% false positive

### Short-Term (This Month)

4. **Balance entropy distribution**
   - Analyze outcome tables across 50 actions
   - Ensure messy success is modal outcome
   - Adjust SYSTEM weighting guidance

5. **Add evolution foreshadowing**
   - NARRATOR hints at pressure building
   - Test player response to telegraphed evolution

6. **Stress-test long campaigns**
   - 25+ turn session
   - Monitor continuity coherence
   - Measure thread.md effectiveness

### Medium-Term (This Quarter)

7. **Multi-campaign support**
   - Campaign listing, selection, forking
   - Test base game refinement through discovery

8. **CAST depth improvements**
   - More secret types
   - Lie detection tells
   - Relationship dynamics

9. **Player dashboard exploration**
   - Pressure visibility
   - Relationship map
   - Arc question status

---

## Success Metrics

### Qualitative

| Metric | Target |
|--------|--------|
| "My choices felt meaningful" | 80%+ of playtesters |
| "I was surprised by outcomes" | 70%+ of playtesters |
| "I discovered who my character became" | 60%+ of playtesters |
| "I want to play again" | 70%+ of playtesters |

### Quantitative

| Metric | Target |
|--------|--------|
| Turns to trait evolution | 15-25 |
| Messy success frequency | 40-50% of outcomes |
| ORACLE catch rate | 95%+ |
| ORACLE false positive rate | <5% |
| Average turn latency | <20 seconds |
| Session recovery success | 100% |

---

## Closing Analysis

### What Makes This Special

1. **Semantic mechanics** — no numbers, only meaning
2. **Discovered identity** — character emerges, isn't built
3. **Genuine uncertainty** — external entropy surprises everyone
4. **World that remembers** — ORACLE enforces consequence
5. **Emergent synthesis** — four agents, one story

### The Core Bet

> Players will find joy in discovering who they become under pressure, rather than designing who they want to be.

This is counter to mainstream RPG design. It's risky. But if it works, it offers something nothing else does: the experience of identity as discovery, not design.

### Final Recommendation

**Proceed to MVG playtest.** The architecture is sound. The philosophy is coherent. The risks are identifiable and mitigable. The core loop is testable.

The question isn't whether this is a good idea — the lenses suggest it is. The question is whether execution matches conception. That requires players.

Build it. Test it. Learn.

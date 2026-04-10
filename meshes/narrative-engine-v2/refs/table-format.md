# Table Format Reference
# Shared rules for generating entropy tables — what to produce
# Used by: character outcome Tasks, world event Tasks

## Character Outcome Tables

Generate exactly 5 outcome shapes across the spectrum:
1. catastrophic — worst realistic version
2. failure — it doesn't work
3. mixed — partial, costly, complicated
4. success — it works as intended
5. breakthrough — better than intended, something shifts

Build weighted ranges from the distribution shape (ranges sum to 100).

## Character Outcome Tables: Structural Only

Character tables are **structural labels, not creative descriptions**. Downstream agents (sim-tables) generate the creative per-beat outcomes. Character tables provide the probability space and outcome shapes.

Each tier: `type`, `shape` (2-3 word label), `mechanical_note` (1-line structural effect).

**No subtables for character tables.** The specific manifestation is determined by sim-tables' per-beat dice, not by architect-level subtable rolls.

Format:
```yaml
outcomes:
  - range: 1-{X}
    type: catastrophic
    shape: {2-3 word label}
    mechanical_note: "{1-line structural effect — trait/bond impacts}"
  - range: {X}-{Y}
    type: failure
    shape: {label}
    mechanical_note: "{effect}"
  - range: {Y}-{Z}
    type: mixed
    shape: {label}
    mechanical_note: "{effect}"
  - range: {Z}-{W}
    type: success
    shape: {label}
    mechanical_note: "{effect}"
  - range: {W}-100
    type: breakthrough
    shape: {label}
    mechanical_note: "{effect}"
```

## Chaos Event Tables (World Events Keep Subtables)

Each chaos event: 7-10 root manifestations, each with exactly 4 subtable entries (3 register-toned using DIFFERENT registers, 1 thematic). World events keep subtables because they feed scenes more directly and are not regenerated downstream.

Each thematic event: 3-7 flat manifestations (no subtables).

## Dialogue Density Rule

When a character is in a beat WITH OTHER CHARACTERS PRESENT, at least 60% of the outcome range (by probability weight) MUST involve the character SPEAKING — saying words, asking questions, responding verbally, deflecting with speech. Physical-only outcomes (silence, freeze, avoidance, pure body language) should occupy no more than 40% of the range.

## Action Tables (Tactic Variation)

Per-beat character action outcomes are **CHARACTER TACTICS** — different approaches to get what the character wants. Frame weighted options as "what tactic does this character try?" not just "what does this character do?"

A character has an objective in the beat. The dice decide HOW they pursue it. Each tactic produces distinct physical and verbal behavior downstream.

```yaml
# Example framing for a character outcome table
# The character WANTS something. The ranges are their tactical options.
outcomes:
  - range: 1-25
    type: failure
    shape: tactic_abandoned      # Character gives up on approach mid-attempt
    mechanical_note: "objective unmet; character withdraws"
  - range: 26-55
    type: mixed
    shape: indirect_approach     # Character circles, deflects, hints
    mechanical_note: "partial contact; character reveals less than intended"
  - range: 56-80
    type: success
    shape: direct_claim          # Character states want plainly
    mechanical_note: "objective met; relationship shifts toward honesty"
  - range: 81-100
    type: breakthrough
    shape: vulnerability_opened  # Character's tactic dissolves into something real
    mechanical_note: "objective exceeded; something beneath surfaces"
```

The `shape` label names the tactic, not the outcome. Voice generators downstream read the tactic and generate the specific words and behavior.

## Output Rules

- Ranges never overlap, always sum to 100
- Never 0% for any shape — entropy can surprise
- Never 100% for anything except firing trajectories
- 2-5 outcomes per level
- Two branch levels maximum: Primary → subtable. Flatten deeper.
- NO dialogue in outcome text. No quoted speech. Describe direction: "deflects with humor" not "'Is that obvious?' with a grin"

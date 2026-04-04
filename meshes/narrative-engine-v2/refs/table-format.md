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

## Subtable Structure

For EACH outcome, generate a subtable with EXACTLY 4 entries:
- 3 register-toned (matching chaos_register, each a DIFFERENT register — no duplicates within a tier)
- 1 thematic (coincidental story resonance — the world accidentally mirrors the story's themes)

**Subtable `result` fields: 15 words max.** Seed the direction, not the choreography. Downstream agents generate scene detail.

Format:
```yaml
subtables:
  {outcome_type}:
    - range: 1-25
      result: "{register-toned A — 15 words max}"
      mechanical_note: "{detail}"
    - range: 26-50
      result: "{register-toned B — 15 words max}"
      mechanical_note: "{detail}"
    - range: 51-75
      result: "{register-toned C — 15 words max}"
      mechanical_note: "{detail}"
    - range: 76-100
      result: "{thematic — 15 words max}"
      mechanical_note: "{detail}"
```

## Chaos Event Tables

Each chaos event: 7-10 root manifestations, each with exactly 4 subtable entries (3 register-toned using DIFFERENT registers, 1 thematic). Same structure as character subtables.

Each thematic event: 3-7 flat manifestations (no subtables).

## Dialogue Density Rule

When a character is in a beat WITH OTHER CHARACTERS PRESENT, at least 60% of the outcome range (by probability weight) MUST involve the character SPEAKING — saying words, asking questions, responding verbally, deflecting with speech. Physical-only outcomes (silence, freeze, avoidance, pure body language) should occupy no more than 40% of the range.

## Output Rules

- Ranges never overlap, always sum to 100
- Never 0% for any shape — entropy can surprise
- Never 100% for anything except firing trajectories
- 2-5 outcomes per level
- Two branch levels maximum: Primary → subtable. Flatten deeper.
- NO dialogue in outcome text. No quoted speech. Describe direction: "deflects with humor" not "'Is that obvious?' with a grin"

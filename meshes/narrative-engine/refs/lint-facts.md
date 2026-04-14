# Lint Facts Reference
# Detection rules for factual consistency checking
# Used by: editor (parallel haiku Task)
# Model: haiku — extraction and comparison, not creative judgment

## Scope

Verify prose-draft.md factual claims are consistent with canonical entity data
and internally consistent within the turn. Extract facts, compare to source, flag conflicts.

## Workflow

### Step 1: Build Fact Index from Entity Data

From the provided character briefs, extract canonical facts into categories:

**Physical** — for each character present:
- Eye color, hair color/style, build, height, skin tone
- Distinguishing features, flush patterns, contrast details

**Habits** — for each character present:
- Coffee preference (how they take it, what they order)
- Alcohol patterns
- Food preferences (vegetarian, etc.)
- Any other habitual behaviors with specific details

**Voice** — for each character present:
- Verbal habits, signature phrases
- Register markers (when drawl surfaces, when academic register drops)
- What they never say

### Step 2: Extract Factual Claims from Prose

Scan prose-draft.md for every concrete factual claim:

**Physical descriptions:**
- Any mention of eye color, hair, skin, build, height
- Body descriptions (breasts, shoulders, hands, etc.)
- Clothing choices referenced as habitual

**Habit references:**
- Coffee orders, drink choices
- Food orders or preferences mentioned
- Alcohol references
- Routine behaviors described as characteristic

**Scene claims in dialogue/debrief:**
- Characters describing what happened earlier in the scene
- Characters quoting what someone said (verify the quote was rendered)
- Characters referencing off-screen events (verify against context.yaml suspended state)

**Identity claims:**
- Ethnicity, age, background references
- Academic position, expertise claims
- Relationship references (who knows whom, how)

### Step 3: Compare Claims to Canon

For each extracted claim:

1. **Find canonical source** — which entity field defines this fact?
2. **Compare** — does the prose match the entity?
3. **Classify mismatch:**
   - `entity-contradiction`: prose directly conflicts with entity data
   - `entity-deviation`: prose plausibly extends entity data but departs from stated preference (flag for editor judgment)
   - `phantom-event`: prose references an event not rendered in this turn's scene
   - `self-contradiction`: prose contradicts itself within the same turn

### Step 4: Check Within-Turn Consistency

Scan for the same fact described differently within the turn:
- Character's eyes described as two different colors
- Character's height/build described inconsistently
- Same event described differently in scene vs debrief
- Dialogue attribution shifts (character A's line later attributed to B)

### Step 5: Check Claim-Scene Consistency

When characters discuss or debrief what happened in the scene:
- Verify the referenced event was actually rendered in the prose
- Verify quotes match what was actually said
- Flag phantom events — claims about unrendered actions

## Output Format

```yaml
# violations-facts.yaml
linter: facts
violation_count: {N}

source_entities:
  - {character_id}.yaml ({key field}: {canonical value})

violations:
  - type: {physical-fact|habit-fact|claim-scene|within-turn-consistency|voice-attribution}
    classification: CREATIVE
    priority: {CRITICAL|HIGH|MEDIUM|LOW}
    category: {entity-contradiction|entity-deviation|phantom-event|self-contradiction}
    entity: {character_id}
    field: {entity field path, e.g. visual.eyes}
    line: {line number in prose-draft.md}
    text: "{quoted prose text}"
    canon_says: "{value from entity}"
    prose_says: "{value in prose}"
    suggestion: >
      {specific fix direction}
```

## Priority Guide

- CRITICAL: Physical fact directly contradicts entity (wrong eye color, wrong ethnicity)
- HIGH: Habit directly contradicts entity (wrong coffee order) OR phantom event in debrief
- MEDIUM: Entity deviation without acknowledgment (accepts drink they canonically reject)
- LOW: Within-turn style inconsistency, minor voice attribution ambiguity

## Constraints

- Compare ONLY against provided entity data. Do not infer canon from narrative context.
- Flag deviations, do not fix. Editor decides whether a deviation is intentional character development.
- When a fact has no canonical source (entity doesn't specify), skip it — absence of data is not a violation.
- Maximum 15 violations per turn. If more exist, report the highest priority ones.

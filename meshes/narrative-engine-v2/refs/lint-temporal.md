# Lint Temporal Reference
# Detection rules for temporal and spatial consistency checking
# Used by: linter coordinator (parallel Task injection)

## Scope

Verify prose-draft.md time references are consistent with canonical timeline (timeline.md),
that character poses and positions are physically continuous, and that both are internally
consistent across beats.

## Workflow

### Step 1: Establish Temporal Context

From the provided sources, determine:
- **Current day** (cumulative count from campaign start)
- **Current period** (morning/afternoon/evening/night/late_night)
- **Time progression across beats** (does time pass? how much?)
- **Previous turn's ending time** (continuity anchor)

### Step 2: Extract Temporal References from Prose

Extract every temporal reference from prose-draft.md:
- Explicit times: "3am", "noon", "that afternoon"
- Relative times: "hours later", "the next morning", "before dawn"
- Implied times: "sunrise light", "streetlights on", "lunch crowd"
- Duration markers: "they'd been talking for hours", "minutes passed"
- Sequence markers: "after dinner", "before she woke", "by the time"

### Step 3: Check Against Timeline

For each temporal reference:
1. Does it match the established period? Timeline says night, prose says "morning sun" → VIOLATION
2. Does it match the previous turn's closing state? Previous turn ended midnight, opens "that same afternoon" → VIOLATION
3. Is the duration plausible? scene_script says 15 minutes between beats, prose implies hours → FLAG
4. Does it match the day count? "yesterday" references events actually 3 weeks ago → VIOLATION

### Step 4: Check Internal Consistency

Within the prose itself:
- Beat 2 references "after dinner" while beat 5 says "before lunch" → VIOLATION
- Time moves forward consistently (no unexplained backwards jumps)
- Time-stretched beats make physical sense (can't walk 5 miles in "a few minutes")

### Step 5: Track Character Poses and Positions

Track each character's **pose** (standing/sitting/lying/kneeling/crouching) and **location** (where in the space) through the scene.

1. Establish opening pose from scene_script closing state or previous turn's closing position
2. Track every pose change through the prose
3. Flag pose teleportation — character changes pose without narrated transition:
   - Sitting → standing with no "stood up", "rose", "got to her feet" → VIOLATION
   - Standing → sitting with no "sat", "sank onto", "dropped to" → VIOLATION
   - Lying → standing with no intermediate movement → VIOLATION
   - Any pose change between paragraphs without being shown → VIOLATION
4. Flag position teleportation — character moves locations without narrated movement:
   - At the desk → at the door with no crossing narrated → VIOLATION
   - In the kitchen → in the living room with no walking narrated → VIOLATION
5. Flag physical impossibilities:
   - Character taps shoulder while described as across the room → VIOLATION
   - Character uses hands while hands described as full/occupied → VIOLATION
   - Character speaks while described as mid-swallow or underwater → VIOLATION

**Key principle:** Characters occupy physical space. They have weight, inertia, and geometry.
Every pose change costs effort and time. If the prose skips the transition, the reader's body
loses track of where everyone is.

## Violation Categories

### Temporal
| Category | Description | Example |
|----------|-------------|---------|
| timeline-contradiction | Prose contradicts established timeline.md | Timeline says night, prose says "morning sun" |
| continuity-break | Prose contradicts previous turn's closing time | Previous turn ended midnight, this opens "that afternoon" |
| internal-inconsistency | Prose contradicts itself within the turn | Beat 2 "after dinner", beat 5 "before lunch" |
| duration-implausible | Time passage doesn't match scene_script | Script says 10 minutes, prose says "hours later" |
| anachronism | Reference to future or impossible-past event | "Yesterday's seminar" when seminar was 3 weeks ago |

### Spatial
| Category | Description | Example |
|----------|-------------|---------|
| pose-teleport | Pose changes without narrated transition | Sitting at table → standing at door, no "stood up" |
| position-teleport | Location changes without narrated movement | In the kitchen → in the hallway, no crossing narrated |
| physical-impossibility | Body geometry contradicts arrangement | Taps shoulder while described as across the room |
| occupied-limb | Uses body part described as occupied/bound | Waves goodbye while carrying boxes in both hands |

## Violation Priority

| Priority | Category | Rationale |
|----------|----------|-----------|
| HIGH | physical-impossibility, occupied-limb | Breaks reader's physical model — immersion-destroying |
| HIGH | timeline-contradiction | Contradicts established canon — confuses reader |
| MEDIUM | pose-teleport, position-teleport | Missing transition — disorienting but recoverable |
| MEDIUM | continuity-break | Cross-turn inconsistency — may be caught by attentive readers |
| LOW | duration-implausible, internal-inconsistency | Soft violations — flagged but may be intentional pacing |

## Graceful Degradation

- **timeline.md absent**: Proceed with internal consistency checks only (Steps 4-5). Note: "timeline.md absent — cross-reference checks skipped."
- **scene_script absent**: Proceed with prose-only temporal extraction. Note: "scene_script absent — beat-level time progression unavailable."
- **state.yaml absent**: Proceed without continuity anchor. Note: "no previous turn state — continuity-break checks skipped."

## Output Schema

Write violations as YAML to the output file specified in your task prompt.

```yaml
linter: temporal
violation_count: {count}

temporal_context:
  current_day: {N}
  period: "{from scene_script/state.yaml}"
  previous_turn_ended: "{time/period from previous state.yaml}"
  time_progression: "{summary of beat-level time movement}"

violations:
  - type: temporal
    classification: CREATIVE
    priority: HIGH
    category: "timeline-contradiction"
    line: {N}
    text: "{quoted prose}"
    timeline_says: "{what timeline.md establishes}"
    prose_says: "{what the prose implies}"
    suggestion: "{how to fix — adjust reference, cut time marker, etc.}"

  - type: spatial
    classification: CREATIVE
    priority: MEDIUM
    category: "pose-teleport"
    line: {N}
    text: "{quoted prose}"
    last_known_pose: "{sitting at table}"
    prose_implies: "{standing at the window}"
    suggestion: "{add transition — 'she stood and crossed to the window'}"
```

## Constraints
- All violations classify as CREATIVE
- Don't flag ambiguous time references that COULD be consistent — only flag clear contradictions
- Include priority: HIGH|MEDIUM|LOW in each violation entry
- If zero violations found, write empty violations list with temporal_context still populated

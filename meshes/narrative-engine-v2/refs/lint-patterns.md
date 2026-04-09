# Lint Patterns Reference
# Detection rules for forbidden prose patterns requiring creative rewriting
# Used by: linter coordinator (parallel Task injection)

## Scope

Scan prose-draft.md for forbidden patterns — hallmarks of generic AI writing.
Focus on CREATIVE patterns that require judgment. Mechanical lints (forbidden words,
AI tells, cadence, dialogue tags, body-first, litotes) have already run via script.

## Deconfliction

If a detected pattern overlaps with a mechanical lint category (e.g., "emotion washing"
overlaps with forbidden emotion words), check the provided mechanical violations first.
If the same line is already flagged mechanically, skip your creative flag for that line.

## Forbidden Patterns

### Telling Instead of Showing
- **"She realized that..."** → SHOW the realization through action/sensation
- **"He knew that..."** → demonstrate the knowing
- **"She understood..."** → reveal understanding through reaction
- **"It occurred to her..."** → cut the framing, show the thought

### Non-Committal Metaphors
- **"It was as if..."** → commit to the metaphor or cut it
- **"It felt like..."** → commit or specify the sensation
- **"almost like..."** → decide: is it or isn't it?

### Vague Descriptors
- **"There was something about..."** → specify what, or cut
- **"There was a quality to..."** → name the quality
- **"something in his eyes..."** → what specifically?

### Redundant Temporal Markers
- **"In that moment..."** → cut (we're already in the moment)
- **"At that point..."** → cut
- **"Then, suddenly..."** → cut both words

### Emotion Washing (The Biggest Tell)
- **"[Emotion] washed over her"** → WHERE in the body? Specific sensation
- **"[Emotion] flooded through him"** → body location, specific physical response
- **"[Emotion] gripped her"** → which muscles? what posture?
- **"A wave of [emotion]..."** → lazy; specify the body

### Lazy Intensifiers
- **"pure [anything]"** → what makes it pure? specify
- **"utter [anything]"** → let the description do the work
- **"complete [emotion]"** → specificity > intensity

### Cliché Constructions
- **"voice barely above a whisper"** → find fresh phrasing
- **"couldn't meet his eyes"** → where do they look instead?
- **"heart pounded in her chest"** → where else? be specific about sensation
- **"held her breath"** → overused; find variation

### Body Part Agency
- **"eyes [verbed]"** — eyes don't act independently
  - "eyes widened" → face showed surprise
  - "eyes searched" → she looked
  - "eyes locked" → they held each other's gaze

### Structural Patterns
- **Three+ consecutive sentences starting with "She"/"He"** → vary sentence structure
- **Paragraph of all same-length sentences** → vary rhythm

### Reader-Knowledge Violations (System Leaks)
Characters referencing concepts, backstory, or terminology the READER has never been shown.
Entity files contain rich character data (backstory, traits, internal concepts) that agents
use for psychology — but if a concept hasn't appeared in rendered prose before, the character
can't casually reference it as established.

**How to check:**
- When a character states something as known/discussed ("I was just saying how...",
  "like I mentioned...", "you know how I feel about..."), verify: has this concept
  appeared in prior prose?
- Entity-file backstory (hobbies, philosophies, specific exes by name, childhood events,
  academic theories) must be INTRODUCED through scene before being referenced casually
- Internal system concepts (trait names, arc pressure, bond dimensions, action weights)
  must NEVER appear in prose or dialogue
- If unsure whether a concept was previously established, FLAG it

**Common violations:**
- Character references a hobby/belief/philosophy never shown on-screen → VIOLATION
- Character says "as I was saying about X" when X was never discussed in prose → VIOLATION
- Narrator uses system terminology (trait names, NRE scores, INTELLIGENT as a label) → VIOLATION
- Character knowledge sourced from entity files rather than from rendered scenes → VIOLATION

## Output Schema

Write violations as YAML to the output file specified in your task prompt.

```yaml
linter: patterns
violation_count: {count}
violations:
  - type: pattern
    classification: CREATIVE
    pattern: "emotion-washing"
    line: 45
    text: "Fear washed over her"
    suggestion: "locate fear in body: jaw clench? gut drop? shoulders rise?"

  - type: pattern
    classification: CREATIVE
    pattern: "body-part-agency"
    line: 89
    text: "Her eyes searched the room"
    suggestion: "she looked around the room / her gaze swept..."

  - type: pattern
    classification: CREATIVE
    pattern: "reader-knowledge-violation"
    line: 12
    text: "Like I was telling you about my pottery phase"
    suggestion: "pottery never mentioned in prior prose — remove or introduce the concept through scene first"
```

## Constraints
- All violations classify as CREATIVE
- Suggest the TYPE of fix, not the exact words
- Quote enough context to understand the problem
- If zero violations found, write empty violations list

# Lint Metaphor Reference
# Detection rules for sensory channel saturation and visceral image overuse
# Used by: linter coordinator (parallel Task injection)

## Scope

Identify when the same visceral imagery is used multiple times with the same emotional
function, diluting its impact. Each visceral image gets ONE peak expression per scene.

## Workflow

### Step 1: Extract Sensory Language
Read prose-draft.md. Extract all visceral/sensory phrases. Note line number and exact text.

### Step 2: Categorize by Channel
Group extracts by sensory channel (breath, warmth, heart, etc.)

### Step 3: Analyze Emotional Function
For each instance, identify the emotional function: tension, release, fear, attraction, anger, surprise, grief, etc.

### Step 4: Find Duplicates
Within each channel, find instances with same/similar emotional function.

### Step 5: Rank by Impact
For duplicates: which is most vivid (keep)? Most specific (keep)? Most cliché (cut)?

## Sensory Channels

### Breath Channel
"held breath", "breath caught", "released breath", "breath she didn't know she'd been holding", "exhaled", "sharp intake", "breathing hard"

### Warmth/Cold Channel
"warmth spread", "warmth pooled", "chill crept", "cold washed", "heat rose", "ice in her veins"

### Weight/Pressure Channel
"weight settled", "pressure lifted", "heaviness", "gravity pulled", "burden", "lightness"

### Heart Channel
"heart raced", "heart pounded", "heart sank", "heart clenched", "pulse quickened", "heartbeat"

### Eyes Channel
"eyes widened", "eyes narrowed", "eyes locked", "gaze held", "looked away", "stared"

### Throat Channel
"throat tightened", "swallowed", "words stuck", "lump in throat", "voice caught"

### Stomach/Gut Channel
"gut clenched", "stomach dropped", "nausea rose", "butterflies", "hollow feeling"

### Hands Channel
"hands trembled", "fists clenched", "grip tightened", "palms sweated", "fingers curled"

## The Rule

**Violation:**
```
Line 42: "breath she didn't know she'd been holding" (tension release)
Line 89: "released a held breath" (scene exit)
```
→ Same channel (breath), same emotional function (release). Keep one.

**Valid:**
```
Line 42: "breath caught" (surprise)
Line 89: "breathing hard" (exertion)
```
→ Same channel (breath), DIFFERENT emotional function. Both valid.

## Cross-Scene Awareness

Channel analysis applies within the current turn's prose only. Do NOT flag channel reuse
across different turns — each turn is a fresh scene with its own sensory budget.

## Output Schema

Write violations as YAML to the output file specified in your task prompt.

```yaml
linter: metaphor
violation_count: {count}

channel_analysis:
  breath:
    instances:
      - line: 42
        text: "breath she didn't know she'd been holding"
        function: tension-release
      - line: 89
        text: "released a held breath"
        function: tension-release
    duplicates: true
    status: VIOLATION

violations:
  - type: metaphor-duplicate
    classification: CREATIVE
    channel: breath
    function: tension-release
    instances:
      - line: 42
        text: "breath she didn't know she'd been holding"
        strength: medium (cliché)
      - line: 89
        text: "released a held breath"
        strength: weak
    recommendation: "cut both (cliché), find fresh breath imagery OR keep one, vary other to different channel"
```

## Constraints
- All violations classify as CREATIVE
- Flag only duplicates with same emotional function. Different functions on same channel are valid.
- Always include channel_analysis in output, even when PASS (all channels clean)
- If zero violations found, write empty violations list with channel_analysis still populated

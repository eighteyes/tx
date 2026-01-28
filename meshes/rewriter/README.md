# Rewriter Mesh

Style extraction and rewriting engine. Extracted from narrative-engine for standalone use.

## What It Does

Two independent workflows:

### 1. Style Extraction

Analyze a writing sample and extract an authorial voice profile.

**Input:** Text sample(s)
**Output:** Structured voice profile (YAML)

Use cases:
- Build `author.yaml` for narrative-engine from sample passages
- Analyze an author's distinctive voice
- Create voice guidelines for consistency checking
- Understand what makes a voice unique vs generic

**Example request:**
```
Extract the authorial voice from this passage:
[passage text]
```

**Output:**
Structured profile with:
- Sentence structure patterns
- Vocabulary register and domains
- Imagery and metaphor preferences
- Dialogue style
- POV and narrative distance
- Pacing and rhythm
- Tone
- Forbidden patterns and signature moves
- Distinctiveness summary

### 2. Style Rewriting

Rewrite input text in a target style/voice.

**Input:** Text + target style (reference samples OR style description)
**Output:** Rewritten text in target voice

Use cases:
- Rewrite prose in different tones (noir, epic, casual, etc)
- Match text to a specific author's voice
- Transform prose for different genres
- Create variations of the same content in different styles

**Example request:**
```
Rewrite this passage in a noir tone:
[passage text]
```

**Or with samples:**
```
Rewrite this passage in the style of these noir detective examples:
[reference text 1]
[reference text 2]
```

**Output:** Rewritten text with style decisions documented

## Workflow

```
INPUT (from core)
    ↓
WRITER
├─ Type 1: Extract voice from sample → profile YAML
└─ Type 2: Rewrite text in target style → rewritten text
    ↓
EDITOR
├─ Type 1: Validate profile completeness and distinctiveness
├─ Type 2: Validate rewrite consistency and naturalness
├─ If valid: APPROVED to core
└─ If issues: Request revision from WRITER
    ↓
OUTPUT (to core)
```

## Quality Standards

### Extracted Profiles Must Be:
- **Specific** — Not generic descriptions like "poetic" but concrete patterns
- **Evidenced** — Patterns actually present in source text
- **Distinct** — Unique to this author, not applicable to many writers
- **Complete** — All voice dimensions addressed
- **Actionable** — Someone could replicate the voice from this profile

### Rewrites Must Be:
- **Consistent** — Voice doesn't drift across the text
- **Faithful** — Original meaning and facts preserved
- **Natural** — Reads as native to target voice, not forced
- **Transparent** — Reader understands the transformation was intentional

## Usage in Narrative-Engine

The `author.yaml` for narrative-engine games can be built or validated using this mesh:

1. Provide writing samples you want the narrator to sound like
2. Run `rewriter` to extract voice profile
3. Use extracted profile to create `author.yaml`
4. Narrator uses `author.yaml` to constrain prose generation

## Agents

**WRITER** (Sonnet)
- Analyzes text for voice/style patterns
- Generates structured voice profiles
- Rewrites text in target styles
- Documents style decisions

**EDITOR** (Sonnet)
- Validates extracted profiles for completeness and distinctiveness
- Validates rewrites for voice consistency and naturalness
- Requests revisions if needed
- Gates approval

## Message Format

Standard TX V4 format with frontmatter:
```yaml
---
to: rewriter/writer
from: core/core
msg-id: unique-id
---
[Task description]
```

## Integration

Can be called from:
- Core (direct voice extraction/rewriting)
- Narrative-engine (author profile creation)
- Any system needing style analysis or transformation

## Limitations

- Works best with samples of 300+ words for extraction (too little = insufficient patterns)
- Style rewriting preserves meaning but may shift subtle emotional nuances
- Target styles work best when specified clearly (named styles, reference samples, or detailed descriptions)
- Author voices with strong genre conventions may be easier to extract/replicate than highly personal stylistic quirks

# Authorship Guide
# Tuning Voice for Narrative Games

Every story has an author. Not you—not the player—but a voice that lives in the prose itself. This guide explains how to discover that voice and encode it in `author.yaml`.

---

## The Problem with Default Prose

AI-generated prose tends toward a recognizable house style: balanced sentences, predictable rhythms, hedged claims, and a kind of polite competence that reads like corporate copy. This is the absence of authorship.

Real prose has *texture*. It makes choices that other writers wouldn't make. It has obsessions—words it returns to, structures it favors, territories it avoids. The author.yaml file is how you encode these choices.

---

## The Five Dimensions of Prose Style

### 1. POV and Psychic Distance

**What it is:** How close the narrative sits to the character's consciousness.

John Gardner's scale of psychic distance:

1. *It was winter of the year 1853.* (Distant, historical)
2. *Henry J. Warburton had never liked snowstorms.* (Objective third)
3. *Henry hated snowstorms.* (Close third)
4. *God how he hated these damn snowstorms.* (Free indirect—thought blends into narration)
5. *Snow. Snow. Goddamn aching snow.* (Stream of consciousness)

Most literary fiction operates between 3 and 4. Genre fiction often uses 2-3. Your choice here affects everything.

**Free indirect discourse** is the sweet spot for interactive fiction: the character's thoughts color the narration without explicit "she thought" tags. The reader inhabits the perspective without being told they're doing so.

```yaml
pov:
  lens: close_interior
  technique: free_indirect
```

**Questions to ask:**
- Whose perception shapes every sentence?
- How much does the narrator know beyond the character?
- Do thoughts appear as dialogue, as narration, or as something in between?

### 2. Temporal Stance

**What it is:** The tense and how it shifts.

Baseline tense establishes the narrative's relationship to time:
- **Past tense**: The story has already happened. The narrator knows the ending. This creates a slight retrospective distance that feels "novelistic."
- **Present tense**: The story is happening now. No one knows what comes next. This creates immediacy but can feel breathless over long stretches.

More interesting than the baseline is *when and why you break it*.

```yaml
tense:
  baseline: past
  variations:
    - trigger: "compulsive or looping thought"
      shift_to: present_progressive
    - trigger: "memory intrusion"
      shift_to: past_perfect
    - trigger: "visceral sensation"
      shift_to: present
```

**Shifts signal psychology.** When a character caught in obsessive thought, shifting to present progressive ("she is checking the door again, she is always checking") creates the texture of compulsion. When trauma surfaces, past perfect ("she had seen this before, had known it would come") layers time.

### 3. Cadence and Sentence Architecture

**What it is:** The rhythm of your prose—sentence length, clause structure, fragment use.

This is where prose becomes musical. Consider three sentence types:

**Long braided sentences (30-50 words):** Complex, with embedded clauses, building tension through accumulation. These work for moments of reflection, description, or psychological complexity.

> She stood at the window watching the snow fall—the same snow she'd watched as a child in that other house, the one they'd left before she could remember leaving, though she remembered the window, the frame of it, the way frost gathered in the corners.

**Medium workhorses (12-25 words):** The sentences that move the story. Clear, propulsive, doing the narrative work.

> The door opened. {character} stepped through, brushing snow from his shoulders. He didn't look at her.

**Short punches (1-6 words):** Impact. Breath. Emphasis.

> She waited.
> Nothing.
> The snow kept falling.

**The ratio matters.** A 30/55/15 split (long/medium/short) creates literary density. A 10/70/20 split feels more thriller-paced. A 40/40/20 split creates a meditative, Sebaldian feel.

**Fragments** are not errors—they're emphasis. Use 3-5 per scene, deliberately.

```yaml
cadence:
  long:
    percentage: 30
    description: "Complex, embedded clauses, psychological density"
  medium:
    percentage: 55
    description: "Narrative workhorses, clear and propulsive"
  short:
    percentage: 15
    description: "Punches, breath, impact"
  fragments:
    count: "3-5 per scene"
```

### 4. Diction: The Word-Hoard

**What it is:** The vocabulary palette the author draws from.

Every writer has a word-hoard—a set of territories they return to, words they reach for. This is perhaps the most important dimension for avoiding AI-generic prose.

**Build your palette from semantic domains:**

| Domain | Example Words | Effect |
|--------|---------------|--------|
| Somatic | ache, tendon, pulse, jaw, gut, spine | Embodied, visceral |
| Cognitive/Tech | protocol, latency, buffer, process, loop | System-aware, contemporary |
| Natural | root, salt, stone, tide, marrow | Elemental, grounded |
| Architectural | threshold, corridor, frame, foundation | Structural, spatial |
| Liturgical | witness, vigil, sanctuary, covenant | Sacred, weighted |
| Mercantile | cost, debt, trade, currency, account | Transactional |
| Medical | symptom, diagnosis, chronic, acute | Clinical distance |
| Textile | woven, frayed, seam, thread, unraveling | Connectedness, decay |

**The blend is the voice.** Mixing somatic + cognitive/tech creates embodied system-awareness. Mixing natural + liturgical creates sacred earthiness. Mixing medical + mercantile creates cold capitalism.

```yaml
diction:
  primary:
    - category: somatic
      words: [ache, pulse, jaw, hands, gut, spine, tendon]
    - category: architectural
      words: [threshold, frame, corridor, foundation, room]
  secondary:
    - category: cognitive_tech
      words: [protocol, process, loop, signal, buffer]
  texture:
    - category: liturgical
      words: [witness, vigil, sanctuary, covenant]
```

**Questions to ask:**
- What does this world feel like in the body?
- What does this world name its concepts after?
- What metaphor system governs understanding?

### 5. Stylistic Devices and Constraints

**What it is:** The specific techniques the author uses—and refuses to use.

Every author has tells. Consistent use of particular devices creates voice.

**Parentheticals:** Asides, qualifications, second thoughts. Use ( spaced ) or (tight). Frequency matters—one per paragraph creates a confiding narrator; one per page creates occasional intimacy.

**Italics:** For emphasis, for foreign terms, for unspoken thought, for somatic sensation. Pick your use and be consistent.

**Catalog lists:** Items in series. Standard commas create pace. Spaced ellipses ("the cup … the window … the door") create pause, significance, weight.

**Dashes:** Em-dashes interrupt—like this—for pivot or aside. Some authors use heavily; some never.

**Meta-brackets:** [ like this ] for system intrusion, frame-break, glitch. Genre-dependent.

**Punctuation constraints** shape rhythm:
- **No semicolons:** Forces shorter sentences or different conjunctions
- **Minimal colons:** Reduces explanatory stance
- **Liberal em-dashes:** Creates breathless, interrupted quality

```yaml
devices:
  parentheticals:
    count: "2-4 per scene"
    format: "spaced"
  italics:
    count: "2-5 per scene"
    use: "somatic sensation, unspoken thought"
  catalog_list:
    count: 1
    format: "spaced ellipses"
  em_dashes: "frequent"

punctuation:
  semicolons: forbidden
  colons:
    max_per_scene: 1
```

---

## How to Extract Voice from Source Material

When adapting existing work or creating a game in a specific style, you need to reverse-engineer the author.yaml from the source.

### Step 1: Sentence-Level Analysis

Take a representative passage (500-1000 words). Count:
- Sentences by length (short/medium/long)
- Fragments
- Instances of each punctuation mark
- Paragraph lengths

This gives you cadence and punctuation constraints.

### Step 2: Word-Level Analysis

Identify recurring vocabulary. Group into semantic domains. Note:
- Words that appear 3+ times
- Unusual word choices (not the expected synonym)
- Consistent metaphor systems

This gives you diction palette.

### Step 3: POV Analysis

Find passages with character interiority. Ask:
- Are thoughts tagged ("she thought") or free indirect?
- How much does narration know beyond character perception?
- Does the narrator editorialize?

This gives you POV and technique.

### Step 4: Device Inventory

Catalog stylistic devices:
- Parenthetical asides
- Italics (and what they're used for)
- List structures
- Unusual punctuation

This gives you devices section.

### Step 5: Negative Space

What does the author *never* do?
- Exclamation points?
- Semicolons?
- Adverbs?
- Dialogue tags beyond "said"?

Constraints are as defining as choices.

---

## Author Profiles by Genre

### Literary Fiction (Domestic/Psychological)

```yaml
voice: "observant, withholding, attuned to silences"

pov:
  lens: close_interior
  technique: free_indirect

cadence:
  long: { percentage: 35 }
  medium: { percentage: 50 }
  short: { percentage: 15 }

diction:
  primary: [somatic, domestic, natural]
  secondary: [psychological]

punctuation:
  semicolons: rare

endings:
  style: attenuate
```

### Noir / Hardboiled

```yaml
voice: "clipped, world-weary, metaphor-drunk"

pov:
  lens: close_interior
  technique: direct_first  # First person, direct

cadence:
  long: { percentage: 15 }
  medium: { percentage: 55 }
  short: { percentage: 30 }  # Punchy

diction:
  primary: [urban, mercantile, somatic]
  secondary: [weather, decay]

devices:
  similes:
    frequency: "one per paragraph"
    style: "incongruous comparison"

endings:
  style: cliffhanger
```

### Horror (Literary)

```yaml
voice: "precise, clinical, wrongness in the details"

pov:
  lens: close_interior
  technique: free_indirect

cadence:
  long: { percentage: 40 }  # Dread builds in long sentences
  medium: { percentage: 45 }
  short: { percentage: 15 }

diction:
  primary: [somatic, medical, architectural]
  secondary: [natural_decay, liturgical]

devices:
  italics:
    use: "wrongness, intrusive sensation"

endings:
  style: attenuate  # Horror lingers
```

### Epic Fantasy

```yaml
voice: "weighted, formal, history-conscious"

pov:
  lens: distant_third  # More omniscient
  technique: reported

tense:
  baseline: past
  variations:
    - trigger: "prophecy or ancient text"
      shift_to: present

cadence:
  long: { percentage: 40 }
  medium: { percentage: 50 }
  short: { percentage: 10 }

diction:
  primary: [natural, architectural, liturgical]
  secondary: [martial, textile]

punctuation:
  semicolons: allowed  # More formal register
```

### Sci-Fi (Near-Future)

```yaml
voice: "system-literate, embodied, dry"

pov:
  lens: close_interior
  technique: free_indirect

cadence:
  long: { percentage: 25 }
  medium: { percentage: 55 }
  short: { percentage: 20 }

diction:
  primary: [cognitive_tech, somatic, corporate]
  secondary: [medical, mercantile]

devices:
  code_fences:
    allowed: true
    use: "logs, interfaces, system output"
  meta_brackets:
    count: "1-2"
```

### Romance

```yaml
voice: "warm, interiority-rich, sensation-forward"

pov:
  lens: deep_interior
  technique: free_indirect

cadence:
  long: { percentage: 35 }
  medium: { percentage: 50 }
  short: { percentage: 15 }

diction:
  primary: [somatic, sensory, emotional]
  secondary: [natural, textile]

devices:
  italics:
    use: "desire, emotional realization"
    count: "4-6 per scene"

endings:
  style: resolution  # Romance delivers the landing
```

---

## Common Mistakes

### 1. Over-specifying

You don't need to fill every field. An author.yaml with five clear constraints is better than one with twenty vague ones. Find the three things that most define this voice.

### 2. Contradictory constraints

If you specify "terse, clipped sentences" and also "40% long braided sentences," you've given impossible instructions. The constraints should be coherent.

### 3. Ignoring genre expectations

A horror game with "warm, sensation-forward" diction will feel wrong. The voice must serve the genre. You can subvert expectations, but know what you're subverting.

### 4. Diction lists that are too narrow

If your word list is only 10 words, you'll get repetitive prose. 30-50 words per domain gives enough variety while maintaining consistency.

### 5. Forgetting the negative space

What the author *refuses* to do is as important as what they do. Specify at least 2-3 things that are forbidden or rare.

---

## The Extraction Process: A Worked Example

**Source:** A passage from the game you're adapting, or prose that captures the desired voice.

**Sample text:**
> She checked the inbox again ( the third time in ten minutes ) and the ache behind her eyes sharpened. The cursor blinked. The fan hummed. The coffee went cold.
>
> Nothing.
>
> The protocol was clear—wait for confirmation before proceeding—but waiting had its own weight, accumulating in her shoulders like something she'd have to carry out of here.

**Analysis:**

1. **Sentences:** 1 long (44 words), 3 short fragments (2-4 words), 1 medium (7 words), 1 long (31 words). Pattern: long → staccato fragments → medium punch → long.

2. **Punctuation:** Spaced parenthetical. Em-dash for interruption. No semicolons. Period fragments for rhythm.

3. **Diction:** somatic (ache, eyes, shoulders), tech/corporate (inbox, cursor, protocol, confirmation), sensory (blinked, hummed, cold), dynamics (weight, accumulating, carry).

4. **POV:** Close interior, free indirect. "Waiting had its own weight" is thought-as-narration.

5. **Devices:** One spaced parenthetical. Catalog list without ellipses ("blinked...hummed...cold"). Somatic metaphor for abstract state.

**Resulting author.yaml:**

```yaml
voice: "dry, embodied, system-literate; skeptical but non-moralizing"

pov:
  lens: close_interior
  technique: free_indirect

tense:
  baseline: past
  variations:
    - trigger: "compulsion, loops"
      shift_to: present_progressive

cadence:
  long: { percentage: 30 }
  medium: { percentage: 55 }
  short: { percentage: 15 }
  fragments: { count: "3-5" }

devices:
  parentheticals: { count: "2-4", format: "spaced" }
  catalog_list: { count: 1, format: "spaced ellipses" }
  italics: { count: "2-5", use: "somatic, affect" }

diction:
  primary:
    - category: somatic
      words: [ache, shoulders, jaw, hands, eyes, gut]
    - category: cognitive_tech
      words: [protocol, process, loop, buffer, signal, confirmation]
  secondary:
    - category: corporate
      words: [policy, compliance, confirmation, proceed]
  texture:
    - category: dynamics
      words: [weight, accumulate, carry, gather, release]

punctuation:
  semicolons: forbidden
  colons: { max_per_scene: 1 }

endings:
  style: attenuate
```

---

## Testing Your Author

After creating author.yaml, test it:

1. **Render the same scene twice** with different author profiles. The difference should be audible.

2. **Read aloud.** Cadence problems become obvious when spoken.

3. **Check for constraint violations.** If you specified "no semicolons" and the prose has semicolons, the profile isn't being followed.

4. **Look for the tells.** The devices you specified should appear at roughly the frequency you specified.

5. **Check the diction.** Sample 50 content words from the output. What percentage come from your specified palettes?

---

## Final Thought

The goal is not to constrain creativity but to channel it. An author.yaml is not a prison—it's a voice. Just as a human author develops consistent style through years of reading and writing, you're giving the narrator a formed sensibility to write from.

The best author profiles feel inevitable in retrospect. Of course this story is told in clipped sentences with somatic diction and spaced parentheticals. Of course it refuses semicolons. Of course it attenuates rather than concludes.

The voice becomes the story's signature. Unmistakably itself.

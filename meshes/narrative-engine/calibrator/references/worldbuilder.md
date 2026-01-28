# Worldbuilder Reference
# Artifact tuning prompts for narrative-engine worldbuilder mode
# Purpose: Enable focused editing of existing game artifacts mid-campaign or post-creation

## Overview

Worldbuilder mode allows players to tune existing artifacts without restarting game creation. Use when:
- Player wants to adjust author voice after seeing prose in action
- Setting needs refinement based on story developments
- Character voices need adjustment after play reveals their nature
- Arc seeds need updating based on discovered story directions

**Key principle:** Extract what the player NOW knows about their world, not what they THOUGHT they knew at creation time.

---

## Artifact Display Templates

### Author (author.yaml)

Display these key fields in readable format:

```markdown
**Voice:** {voice one-liner}
**POV:** {pov.lens} using {pov.technique}
**Tense:** {tense.baseline}
**Cadence:** {long}% long / {medium}% medium / {short}% short, {fragments} fragments per scene

**Diction domains:** {diction.primary joined}
**Forbidden words:** {diction.forbidden joined}

**Devices:**
- Parentheticals: {devices.parentheticals.count}
- Italics: {devices.italics.count} ({devices.italics.use})

**Scene endings:** {endings.style}
```

### Setting (setting.yaml)

```markdown
**Era:** {era}
**Atmosphere:** {atmosphere}

**World Truths:**
{truths as bulleted list}

**The Lie Everyone Believes:** {lie}

**Constraints:**
{constraints as bulleted list}
```

### Arc (arc.yaml)

```markdown
**Dramatic Question:** {dramatic_question}

**Phases:**
{phases as numbered list with brief description}

**Seeds:**
{seeds as bulleted list}

**Possible Endings:**
{possible_endings as bulleted list}

**Forbidden Endings:**
{forbidden_endings as bulleted list}
```

### Protagonist (protagonist.yaml)

```markdown
**Name:** {name}
**Core Trait:** {core_trait}

**Want:** {want}
**Need:** {need}
**Wound:** {wound}

**Voice:**
- Cadence: {voice.cadence}
- Register: {voice.register}
- Signature phrases: {voice.signature_phrases joined}
```

### Entities (entities.yaml)

For each significant character:
```markdown
**{name}** ({role})
- Want: {want}
- Secret: {secret}
- Voice: {voice.cadence}, {voice.register}
- Signature: "{voice.signature_phrases[0]}"
```

---

## Artifact Tuning Prompts

### Tuning: Author Voice

**Initial prompt:**
```
What feels off about the current prose style?

Common adjustments:
- **Too dense** — shorter sentences, more white space
- **Too sparse** — richer description, longer sentences
- **Too distant** — closer interior, more thought access
- **Too interior** — pull back, observational distance
- **Wrong rhythm** — adjust cadence distribution
- **Wrong register** — vocabulary level (elevated vs. vernacular)

What specifically would you like to change?
```

**After response, render variations:**

Generate 2-3 versions of a characteristic scene from the current game:
- Apply their requested change
- Apply it more extremely
- Apply a contrasting approach

```yaml
---
to: core/core
from: narrative-engine/calibrator
msg-id: worldbuilder-tune-author-{iteration}
headline: Voice variations
---
Here's a scene from your game rendered with adjustments:

**Option A:** {description of change applied}
[50-100 word sample]

**Option B:** {change applied more extremely}
[50-100 word sample]

**Option C:** {alternative interpretation}
[50-100 word sample]

Pick one, blend elements ("A's cadence with C's vocabulary"), or ask for more.
```

**Refinement loop:**
Continue until player confirms with "yes," "that's it," "perfect," or equivalent.

---

### Tuning: Setting

**Initial prompt:**
```
What aspect of your world needs adjustment?

- **Truths** — what's true here that shouldn't be?
- **Atmosphere** — how the world FEELS
- **Era** — time period, tech level, social structures
- **Constraints** — what must NEVER happen?
- **The Lie** — what everyone believes that isn't true?

Describe what you want to change.
```

**Follow-up questions by area:**

**Truths adjustment:**
- "Which truth feels wrong now that you've played in this world?"
- "What new truth has emerged from play?"
- "What truth exists that you didn't know at creation?"

**Atmosphere adjustment:**
- "What's the feeling you're NOT getting that you want?"
- "What scenes have felt off-tone? Describe the dissonance."
- "Give me a moment that had the RIGHT feeling — what made it work?"

**Constraints adjustment:**
- "What happened that shouldn't have been possible?"
- "What's now obviously forbidden that wasn't before?"
- "What constraint is too tight? What should the world allow that it doesn't?"

---

### Tuning: Arc

**Initial prompt:**
```
What aspect of the dramatic structure needs work?

- **Dramatic question** — the core tension driving the story
- **Phases** — the shape of the journey
- **Seeds** — hooks and mysteries waiting to bloom
- **Endings** — possible termination states
- **Forbidden endings** — what must NEVER happen

What feels misaligned?
```

**Follow-up questions by area:**

**Dramatic question:**
- "What question is the story ACTUALLY asking now?"
- "What felt like the central tension at creation vs. what it's become?"

**Seeds adjustment:**
- "Which seeds have bloomed? Should they be removed or marked resolved?"
- "What new mysteries emerged from play?"
- "What strange detail keeps appearing that you didn't plant?"

**Endings adjustment:**
- "What ending is now possible that wasn't before?"
- "What ending has become impossible based on what's happened?"
- "What ending would now feel like a betrayal?"

---

### Tuning: Protagonist

**Initial prompt:**
```
What about the protagonist needs adjustment?

- **Core trait** — what defines them
- **Want** — their conscious desire
- **Need** — their unconscious requirement for growth
- **Wound** — the damage they carry
- **Voice** — how they speak and think

What's revealed itself through play?
```

**Follow-up questions by area:**

**Want/Need refinement:**
- "What does the protagonist ACTUALLY want now? Has it shifted?"
- "What do they need that you didn't know before?"
- "Have want and need come into conflict yet? How?"

**Wound refinement:**
- "Has the wound revealed new dimensions?"
- "Is there a deeper wound beneath the one you named?"
- "Has play shown how the wound manifests in unexpected ways?"

**Voice adjustment:**
(Use Phase 6b voice extraction questions from game-maker.md, focused on refinement)
- "What speech patterns have emerged that feel RIGHT?"
- "What have they said that felt out of character? What would be better?"

---

### Tuning: Entities (NPCs)

**Initial prompt:**
```
Which character needs adjustment?

{list current entities with one-line description each}

Name the character, or describe what you want to add/change.
```

**For existing character:**
```
What about {name} needs work?

- **Motivation** — what they want, what drives them
- **Secret** — what they're hiding
- **Relationship** — their connection to protagonist/others
- **Voice** — how they speak

What's revealed itself through play?
```

**Voice refinement:**
```
How has {name}'s voice evolved through play?

- What lines have felt MOST them?
- What lines felt wrong? What would they actually say?
- Any new verbal tics or patterns that emerged?
```

**Adding new character:**
```
Tell me about the new character:

- Who are they?
- What do they want?
- What's their relationship to the existing cast?
- How do they TALK? (A line that IS them)
```

---

## Confirmation Patterns

### Before writing changes:

```yaml
---
to: core/core
from: narrative-engine/calibrator
msg-id: worldbuilder-confirm-{artifact}-{timestamp}
headline: Apply changes?
---
Here's what will change in **{artifact}.yaml**:

**Current:**
{relevant field: current value}

**New:**
{relevant field: new value}

{repeat for each changed field}

Apply these changes?
- **Yes** — write and return to selection
- **No** — discard and return to tuning
- **Refine** — adjust further
```

### On "Done" from artifact selection:

```yaml
---
to: core/core
from: narrative-engine/calibrator
msg-id: worldbuilder-complete-{timestamp}
headline: Worldbuilder session complete
---
Worldbuilder session complete.

Modified:
{list artifacts_modified}

Changes take effect immediately. The next turn will use your updated world.
```

---

## Mid-Creation Detection

During new-game extraction, detect worldbuilder intent in ask-response:

**Trigger phrases:**
- "wait", "hold on", "actually"
- "go back", "can we change", "let me edit"
- "the setting should be", "the author voice isn't right"
- Any artifact name + modification verb ("edit", "change", "tune", "adjust")

**On detection:**
1. Acknowledge: "Got it — let's adjust {artifact} before continuing."
2. Save interrupted state
3. Switch to worldbuilder mode, wb_phase: display
4. After worldbuilder completes, resume new-game flow

---

## Quality Standards

- **Show before telling:** Always display current state before asking for changes
- **Confirm before writing:** Never write without explicit approval
- **Extract, never prescribe:** Their vision, refined by play
- **Preserve working elements:** Only change what they ask to change
- **Follow energy:** If they light up about a discovery, capture it
- **Distinguish discovery from drift:** "This emerged through play" vs. "I changed my mind"

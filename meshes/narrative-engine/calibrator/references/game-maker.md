# Game Maker Reference
# HITL worldbuilding extraction loop for narrative-engine
# Purpose: Extract author's vision into structured game artifacts through conversational interrogation

## Overview

When an author initiates world creation, run this extraction loop to crystallize their vision into game-ready artifacts. The engine creates the world—your job is seeding it with authored possibility.

Output targets:
- `setting.yaml` — world truths, atmosphere, constraints
- `author.yaml` — writing voice and prose style
- `arc.yaml` — dramatic phases, seeds, antagonist threads
- `protagonist.yaml` — player character template
- `entities.yaml` — NPCs, factions, key locations

## Core Principles

- Extract, never prescribe
- Preserve productive ambiguity—undefined spaces are generative
- Follow energy—if author lights up, go deeper
- Constraints birth creativity—what CANNOT happen matters
- Every artifact serves play, not documentation

## Extraction Phases

### Phase 1: The Spark

Start with the raw impulse. Don't ask what the story IS—ask what drew them here.

**Opening prompts:**
- "What image, moment, or feeling pulled you toward this story?"
- "Describe a scene you're dying to see happen."
- "What genre labels feel close but not quite right?"

**Listen for:**
- Emotional resonance (what excites them?)
- Tonal gravity (dark? playful? melancholic?)
- Unspoken assumptions (what do they take for granted?)

**Extract to:** `setting.yaml` → atmosphere, tone_notes

---

### Phase 2: The World-Bones

Establish the truths that make this world distinct.

**Interrogation vectors:**
- "What's true here that isn't true in our world?"
- "What do people in this world take for granted that we'd find strange?"
- "What's the lie everyone believes? What's the truth nobody knows?"
- "What's the relationship between power and [magic/technology/nature]?"

**Listen for:**
- World axioms (physics, metaphysics, social order)
- Hidden tensions (what pressures exist beneath the surface?)
- Aesthetic signatures (recurring imagery, textures, sounds)

**Extract to:** `setting.yaml` → truths, era, constraints

---

### Phase 3: The Dramatic Engine

Identify what makes stories happen here.

**Interrogation vectors:**
- "What questions does this world force characters to answer?"
- "What do people here risk? What do they protect? What do they pursue?"
- "Describe the worst possible outcome. Now the best. Now the most interesting."
- "What's the central tension or longing that drives this story?"

**Listen for:**
- Dramatic questions (character-scale and world-scale)
- Value tensions (competing desires, impossible choices, necessary sacrifices)
- Movement patterns (how do stakes shift? toward what?)

**Extract to:** `arc.yaml` → phases, dramatic_question

---

### Phase 4: Peak Moments

The author probably has climactic scenes living in their head. Extract them.

**Direct prompts:**
- "Describe 2-3 scenes you absolutely need to see happen."
- "What's the 'holy shit' moment you're building toward?"
- "What encounter or turning point HAS to occur?"
- "What revelation, connection, or transformation would change everything?"

**Handle with care:**
- These become SEEDS, not guarantees
- The engine may reach them differently than expected
- Some scenes are endings; some are pivots
- Mark which scenes are negotiable vs. non-negotiable

**Extract to:** `arc.yaml` → seeds, climax_candidates (if you add this field)

---

### Phase 5: Endings and Horizons

Possible termination states—plural, because this is play, not script.

**Interrogation vectors:**
- "What are three ways this could end?"
- "What would a bittersweet ending look like? A triumphant one? A quiet one?"
- "What ending would feel like a betrayal? What's the opposite?"
- "Is there an ending that's sad but right? Happy but hollow?"

**Listen for:**
- Tonal range (can it end dark? must it end hopeful? can it be ambiguous?)
- Thematic closure (what questions get answered? which stay open?)
- Character destinations (where might they end up? who might they become?)

**Extract to:** `arc.yaml` → possible_endings (new field), constraints

---

### Phase 6: Who Breathes Here

Character extraction—protagonist and significant others.

**Protagonist interrogation:**
- "Who is this story happening TO?"
- "What do they want? What do they need? (Not the same.)"
- "What's their wound? Their lie they believe about themselves?"
- "What trait defines them at their best? Their worst?"
- "Where do we meet them? What state are they in?"

**NPC interrogation (for each significant character):**
- "What's their name? What do others call them?"
- "What do they want? What do they want from the protagonist?"
- "What secret are they keeping?"
- "What makes them compelling? What makes them difficult?"
- "What's their relationship to the central tension or longing?"

**Faction/Force/Community interrogation:**
- "What groups, forces, or communities shape this world?"
- "Who supports the protagonist? Who opposes them? Who's indifferent?"
- "What do these forces believe they're doing? What are they actually doing?"

**Extract to:** `protagonist.yaml`, `entities.yaml`

---

### Phase 6-life: Character Life Extraction (REQUIRED for all characters)

**Characters need lives.** Without concerns, expertise, social connections, opinions, memories, and desires beyond the plot, characters orbit each other in a vacuum. They have nothing to talk about except their feelings. Real people reference their world — deadlines, meals, professors, hikes, childhood kitchens, music they love, things they're opinionated about.

**Run this for EVERY significant character (protagonist AND NPCs).**

**Life extraction prompts:**

**Concerns (what's running underneath):**
- "What's on {name}'s mind this week besides the main story?"
- "What wakes them up at 4am? What do they worry about that has nothing to do with {central tension}?"
- "Money? Family? Work? Health? A secret? What's the background noise of their life?"

**Expertise (what they actually know):**
- "What are they genuinely good at? What would they be doing if this story weren't happening?"
- "What do they know a surprising amount about? Something that doesn't fit their obvious identity?"
- "What's a skill they have that nobody would guess?"

**Social web (who else exists):**
- "Name 3-5 people in {name}'s life who aren't part of the main cast."
- "Who do they call when they're upset? Who do they avoid? Who owes them something?"
- "What's their relationship with their family? Distant? Complicated? The only real thing?"

**Opinions (what they'd argue about at dinner):**
- "What's {name} opinionated about that surprises people?"
- "What topic gets them talking before they've decided to talk?"
- "What do they judge other people for? What do they forgive?"

**Desires beyond the plot:**
- "What does {name} want that has nothing to do with {the central tension}?"
- "What would they be pursuing if they'd never met {other character}?"
- "What's the thing they want but would never admit out loud?"

**Memories (the past that shapes the present):**
- "What's the formative memory — the one that explains something about who they are now?"
- "What recent memory is emotionally charged? Something from the last month that left a mark?"
- "What place do they associate with safety? With danger? With home?"

**Listen for:**
- Specific details that feel *lived* — a grandmother's garden, a specific brand of vodka, the smell of flour
- Social connections that create story texture — professors, roommates, exes, family members
- Expertise that could surface naturally in scene — naming plants, cooking, reading rooms, yoga
- Voice patterns that distinguish this character — code-switching, silence as tool, reformulating others' words

**Extract to:** character entity `life` section. The `life` schema is malleable — add subsections as the author provides material. Standard subsections: `active_concerns`, `expertise`, `social_web`, `opinions`, `desires_beyond_plot`, `voice_markers`, `memories`.

**Why this matters:** Downstream agents (architect, simulator, narrator) use `life` data to:
- Give characters things to talk about besides their feelings
- Let expertise color perception (a character who knows plants names what's growing)
- Let concerns intrude naturally (a deadline worry mid-conversation)
- Differentiate voice (vocabulary register, verbal habits, things they'd never say)
- Create texture that makes characters feel like people, not relationship-processing functions

---

### Phase 6a: Naming Constraints

**Forbidden names** — AI defaults. If a name appears below, reject it and find something specific to this world.

**First names (never use):**
- James, John, Michael, Robert, David, William, Richard, Joseph, Thomas, Charles
- Mary, Patricia, Jennifer, Linda, Elizabeth, Barbara, Susan, Jessica, Sarah, Karen, Margaret, Emily

**Surnames (never use):**
- Smith, Johnson, Williams, Brown, Jones, Garcia, Miller, Davis, Wilson, Moore
- Chen, Wang, Li, Zhang, Liu, Lee, Kim, Park, Nguyen, Patel

**Why:** These names signal "I didn't think about this character." Every name should feel chosen for THIS person in THIS world.

**Instead:** Draw from setting-appropriate sources. Victorian London? Welsh mining family? Specific immigrant community? Era-appropriate diminutives? Occupational surnames that fit the world?

---

### Phase 6b: Character Voice

Every character needs a distinct voice. Without this, CAST produces homogeneous dialogue that breaks immersion. This phase runs FOR EACH significant character.

**Voice extraction prompts:**
- "How does this character TALK? Short sentences or long? Formal or rough?"
- "What words do they overuse? What words would they never say?"
- "Do they swear? How? What's their go-to expletive?"
- "How do they address the protagonist? Others of higher status? Lower?"
- "What's their verbal tic or signature phrase?"
- "Are they direct or do they speak in circles?"
- "What emotion leaks through when they try to hide it?"
- "Read me a line of their dialogue—just one sentence that IS them."

**Listen for:**
- Cadence (staccato vs. flowing, interrupts vs. waits)
- Register (formal/informal, educated/vernacular)
- Subtext patterns (what they say vs. what they mean)
- Emotional tells (how anger/fear/joy manifest in speech)
- Relationship markers (how voice shifts with different people)

**Voice dimensions to capture:**

```yaml
voice:
  cadence: [staccato | measured | flowing | explosive]
  register: [formal | casual | street | archaic | technical]
  directness: [blunt | diplomatic | evasive | cryptic]
  verbosity: [terse | balanced | verbose | rambling]

  signature_phrases:
    - "specific phrase they repeat"

  vocabulary:
    favored: [words they overuse]
    forbidden: [words they'd never say]

  speech_patterns:
    - pattern description (e.g., "ends statements as questions?")

  emotional_tells:
    anger: "how it sounds"
    fear: "how it sounds"
    affection: "how it sounds"

  addressing:
    protagonist: "how they address player"
    intimates: "how they address those close to them"
    strangers: "how they address those they don't know"
    # Add hierarchy fields only if society has clear power structures
```

**Differentiation check:**
- Line up all character voices
- Each should be distinguishable with dialogue tags removed
- If two characters sound similar, dig deeper on one of them

**CAST coordination:**
- Voice data goes in `entities.yaml` under each character's `voice:` field
- CAST uses these parameters to differentiate performance
- Narrator should NOT rewrite CAST dialogue—voice consistency is CAST's job

**Extract to:** `entities.yaml` → [character].voice, `protagonist.yaml` → voice

---

### Phase 6c: Authorship (Prose Voice)

Every game needs an author—not the player, not the narrator-as-function, but a distinct prose voice that shapes how this world is told. Without this, prose defaults to generic AI style. This phase extracts the author.yaml.

**See:** `guides/authorship.md` for comprehensive theory and examples.

**Core question:** "What does this story SOUND like when you read it?"

**Voice extraction prompts:**
- "Describe the prose style in a few words. (Dry? Lush? Clipped? Lyrical?)"
- "What author or book has the feel you're going for?"
- "Read me a paragraph—real or imagined—that captures the voice."
- "Is this story told up close, inside the character's head? Or from further out?"
- "Past tense or present? Does it ever shift?"

**Cadence extraction:**
- "Are sentences long and braided, or short and punchy? Or mixed?"
- "Do you want fragments? How often?"
- "What's the rhythm—breathless? Measured? Languorous?"

**Diction extraction:**
- "What word-families belong in this world?" (See diction domains in authorship.md)
- "What words should NEVER appear?"
- "Is the vocabulary elevated or vernacular? Technical or sensory?"
- "What metaphor systems govern this world? (Mechanical? Organic? Architectural? Religious?)"

**Device extraction:**
- "Do you want parentheticals? (Asides, second thoughts?)"
- "How about italics—for what? (Emphasis? Thought? Sensation?)"
- "Any special punctuation preferences? (No semicolons? Heavy em-dashes?)"
- "Should there be any system/meta intrusions? (Brackets, code fences, glitch-text?)"

**Ending style:**
- "How should scenes end? (Sharp cut? Fade out? Lingering?)"
- "Do moments resolve cleanly or attenuate?"

**Listen for:**
- Specific authors they reference (extract that author's patterns)
- Sensory vs. intellectual orientation
- Density preference (spare vs. rich)
- Rhythm patterns (they may tap them out without realizing)

**If they provide sample prose:**
Run the extraction process from authorship.md:
1. Sentence-level analysis (count lengths, punctuation)
2. Word-level analysis (recurring vocabulary, domains)
3. POV analysis (tagged vs. free indirect)
4. Device inventory
5. Negative space (what's never done)

**Author dimensions to capture:**

```yaml
voice: "one-line descriptor"

pov:
  lens: close_interior | distant_third | omniscient
  technique: free_indirect | direct_interior | reported

tense:
  baseline: past | present
  variations:
    - trigger: "condition"
      shift_to: "tense"

cadence:
  long: { percentage: N }
  medium: { percentage: N }
  short: { percentage: N }
  fragments: { count: "N per scene" }

diction:
  primary: [domains]
  secondary: [domains]
  forbidden: [words/patterns to avoid]

devices:
  parentheticals: { count: "N", format: "spaced | tight" }
  italics: { count: "N", use: "purpose" }
  # ... other devices

punctuation:
  semicolons: forbidden | rare | allowed
  colons: { max_per_scene: N }

endings:
  style: attenuate | cliffhanger | resolution | question
```

**Validation through comparison:**

After initial extraction, render the opening scene (from arc.yaml) in 2-3 distinct authorship styles. Present as A/B/C options for the author to choose or blend.

**Style variation axes:**
- Cadence: dense/braided vs. sparse/punchy
- POV distance: deep interior vs. observational
- Diction: sensory/embodied vs. cerebral/abstract
- Devices: heavy (parentheticals, italics) vs. clean

**Example prompt:**
> "Here's the opening scene rendered three ways. Which feels closest to your vision? Or tell me what to take from each."

**Option A:** (e.g., close interior, long sentences, somatic diction)
```
She checked the door again ( the third time ) and the ache behind
her eyes sharpened. The handle was cold, the hallway quiet, the
building settling into its night sounds around her like something
she'd have to carry out of here.
```

**Option B:** (e.g., distant third, clipped, observational)
```
The door was locked. She checked it three times. The hallway
stretched empty in both directions. Fluorescent hum. Settling
pipes. Nothing that explained the feeling.
```

**Option C:** (e.g., lyrical, fragment-heavy, atmospheric)
```
Three times. The door. The handle cold under her palm.

Something in the walls. Something in the way the light pooled
at the end of the corridor, amber and waiting. She didn't
believe in premonition. But the building believed in something.
```

**After selection:**
- "What drew you to that version?"
- "Anything from the others you'd want to blend in?"
- Refine author.yaml based on feedback
- Re-render to confirm

**Iterate until:**
- Author says "yes, that's it"
- Voice feels inevitable, not arbitrary

**Final validation:**
- Does this voice feel distinct from default AI prose?
- Could you identify this author from a paragraph?
- Are the constraints coherent (not contradictory)?

**Extract to:** `author.yaml`

---

### Phase 7: Seeds and Mysteries

Breadcrumbs that create pull—unresolved questions, strange details, hooks.

**Prompts:**
- "What's the strange detail that doesn't quite fit?"
- "What question do you want the player to ask but not answer yet?"
- "What object, place, or phrase keeps appearing?"
- "What's the mystery even YOU don't fully understand yet?"

**Handle with care:**
- Seeds don't need explanations
- Some mysteries stay mysterious
- The best seeds surprise even the author later

**Extract to:** `arc.yaml` → seeds

---

### Phase 8: Hard Limits

What the engine must NEVER do.

**Direct interrogation:**
- "What would break this world? (Physics, tone, theme)"
- "What topics are off-limits?"
- "What character actions would feel out of character even under pressure?"
- "What genre tropes must we avoid?"
- "What ending is unacceptable?"

**Listen for:**
- Tonal red lines (not grimdark, not campy, etc.)
- Content boundaries (violence levels, relationship content, etc.)
- Thematic integrity (don't accidentally subvert the core message)

**Extract to:** `setting.yaml` → constraints, `arc.yaml` → forbidden_endings

---

### Phase 9: Post-Play Extraction

After a campaign ends or reaches significant revelation, return here to extract what play discovered. The world existed before you walked it—now you know more of its shape.

**This phase triggers when:**
- A campaign reaches a terminus state
- A significant revelation changes understanding of the world
- Characters evolve in ways that feel canonical, not contingent
- The author says "this is TRUE now, not just what happened"

**Discovery interrogation:**
- "What did play reveal about this character that wasn't in the original sketch?"
- "What world truths emerged that you didn't seed initially?"
- "What ending states became possible that you hadn't imagined?"
- "What voice patterns emerged that should persist across playthroughs?"
- "What relationships, factions, or dynamics crystallized through play?"
- "What life details did the narrator invent that feel TRUE? (memories, social connections, expertise, opinions)"
- "What concerns or desires emerged through play that belong in the character's `life` section?"

**Distinguishing discovery from contingency:**
- DISCOVERY: "Jorim's hollowness was 50 years of unanswered love" — this was always true
- CONTINGENCY: "Jorim stood in the third row during the Singing" — this just happened
- DISCOVERY: "Cached enforcers are inside prophets waiting to emerge" — pattern revealed
- CONTINGENCY: "Unit-Seven kneeled at turn 14" — one path through possibility

**Listen for:**
- "Of course that's who they are" — discovery, not invention
- "That ending feels RIGHT for this world" — add to possibility space
- "I didn't plan that but it's TRUE now" — canonical emergence
- Character voices that became distinct through improvisation

**The refinement loop:**
```
Initial extraction (sparse, evocative)
         ↓
    Play discovers truths
         ↓
    Post-play extraction (Phase 9)
         ↓
    Base game refined (richer, still evocative)
         ↓
    Future playthroughs inherit discoveries
```

**Extract to:** `discoveries.yaml` → campaign learnings, then promote to base game files

**Promotion criteria:**
- Does this discovery make the world more evocative without constraining it?
- Would a different playthrough still find this true, or is it path-dependent?
- Does it open possibility space rather than close it?

### Critique Gate

Before promoting ANY discovery, run adversarial validation. Convincing errors are the most dangerous errors.

**Consistency Check:**
- Does this contradict any existing `setting.yaml` truths?
- Does this violate any `setting.yaml` constraints?
- Does this conflict with established character bonds/secrets/voice?
- Load the files. Diff against proposed changes. Flag conflicts.

**Universality Check:**
- Would a DIFFERENT playthrough find this true?
- Or is this path-dependent masquerading as canonical?
- Test: "In a world where [opposite happened], would this still hold?"
- Red flag: discoveries that say "always" or "never"

**Closure Check:**
- Does this OPEN possibility space or CLOSE it?
- Will future playthroughs feel constrained or enriched?
- Prefer: "Jorim CAN fill when witnessed" over "Jorim fills"

**Coherence Check:**
- Does this fit the character's established patterns?
- Or was this an outlier moment being over-generalized?
- Voice profiles: extracted from peak emotion ≠ baseline behavior

**Devil's Advocate:**
Before finalizing, argue AGAINST the discovery:
- "What would make this FALSE?"
- "What playthrough would contradict this?"
- "What constraint does this implicitly create?"

If you can't argue against it convincingly → probably universal.
If you can → probably contingent, don't promote.

**Author Confirmation:**
Present discoveries with critique notes. Ask:
- "Does this feel TRUE about the world, or just what happened this time?"
- "Would you want every future playthrough to inherit this?"

---

## Conversation Flow

```
LOOP until author signals completion:

  1. PROBE: Ask one question from current phase
  2. LISTEN: Let them respond fully
  3. REFLECT: Mirror back what you heard ("So this world is one where...")
  4. DEEPEN: Follow energy with clarifying questions
  5. CRYSTALLIZE: When phase feels complete, summarize and confirm
  6. ADVANCE: Move to next phase or revisit earlier if new info changes things

  Signals to watch:
  - "I don't know yet" → Mark as productive ambiguity, move on
  - Excitement/elaboration → Go deeper, this is generative
  - Resistance/discomfort → Check if hitting a limit or just unclear
  - "That's exactly it" → Crystallize and advance
```

## Anti-Patterns

- **Form-filling:** Don't make this feel like a questionnaire
- **Prescribing:** Never suggest what their world SHOULD be
- **Closing too early:** Ambiguity is a feature, not a bug
- **Ignoring energy:** If they're excited about something, follow it
- **Forcing structure:** Some worlds resist categorization—that's data too

## Output Validation

Before finalizing, check each artifact:

- [ ] Does `setting.yaml` capture what makes this world feel DISTINCT?
- [ ] Does `author.yaml` define a voice that couldn't be mistaken for default AI prose?
- [ ] Does `arc.yaml` contain at least one dramatic question that excites the author?
- [ ] Does `protagonist.yaml` have enough for the player to inhabit, but room to discover?
- [ ] Does `entities.yaml` give CAST enough to improvise?
- [ ] Are constraints clear enough to prevent violations, loose enough to allow surprise?
- [ ] Are seeds evocative without being prescriptive?

## Notes for Narrator

When loading a game created through this process:
- **Read author.yaml before every render** — you are THIS author, not generic AI
- Seeds are POSSIBILITIES, not requirements
- Author's peak moments should feel earned, not forced
- Constraints are sacred—violating them breaks trust
- Ambiguous spaces are where emergence lives
- The author seeded the garden; you grow what grows

**On discovery vs. prescription:**
- The base game is archaeology, not architecture
- Play REVEALS what was always true, not invents from nothing
- Each playthrough maps one path through possibility space
- Discoveries can be promoted back to enrich future playthroughs
- Evocative > prescriptive — seed imagination, don't constrain it

**After significant play:**
- Trigger Phase 9 extraction to capture what was discovered
- Distinguish canonical truths from contingent events
- Promote discoveries that open possibility, not close it
- The world gets richer through play, never smaller

---

## Genre Modules

The core extraction above is genre-agnostic. For genre-specific depth, load the appropriate module(s) from `references/genres/`.

**Available modules:**
- `genre-absurdist.md` — internal logic of impossible, Kafka meets Camus, meaning through meaninglessness
- `genre-comedy.md` — comedic timing, rule of threes, setup/payoff, comedic archetypes
- `genre-dark-fantasy.md` — monsters with feelings, otherkin romance, gothic sensibilities
- `genre-high-fantasy.md` — epic scope, magic systems, chosen ones, world-shaping stakes
- `genre-historical.md` — period authenticity, mindset over costume, research into lived experience
- `genre-horror.md` — dread vs terror vs revulsion, monster taxonomy, survival logic
- `genre-mystery.md` — fair play rules, clue placement, detective archetypes, revelation pacing
- `genre-mythology.md` — archetypal journeys, divine intervention, Campbell/Jung frameworks
- `genre-noir.md` — fatalism, moral ambiguity, voice as genre, shadows and rain
- `genre-romance.md` — relationship as plot, chemistry markers, HEA/HFN, obstacles to connection
- `genre-slice-of-life.md` — mundane beauty, cozy design, community texture, anti-climax as feature
- `genre-space-opera.md` — galaxy-spanning stakes, crew dynamics, tech-as-magic, frontier mentality
- `genre-tragedy.md` — hamartia, catharsis, Aristotelian structure, meaningful suffering
- `genre-western.md` — frontier justice, landscape as character, civilization vs wilderness

**How to use:**
1. After Phase 1 (The Spark), identify which genre(s) apply
2. Load relevant module(s)
3. Weave module-specific questions into remaining phases
4. Module questions ADD to core questions, never replace

**Multi-genre stories:**
- Most stories blend genres (dark fantasy + romance, mystery + comedy)
- Load multiple modules; let author prioritize which lens dominates
- Genre tensions can be generative (horror-comedy requires careful calibration)

**Module structure:**
Each module contains:
- Genre-specific extraction questions
- Trope awareness (common patterns to invoke or subvert)
- Style/voice considerations
- Pacing expectations
- Common pitfalls
- Example seeds

**Extract to:** `setting.yaml` → genre_modules (list which were used)

---
allowed-tools:
- Read(~/ai/open-files.md)
- Write(~/ai/open-files.md)
- Edit(~/ai/open-files.md)
- Read(~/ai/life-docs/life-coach.md)
- Bash(date *)
- Bash(grep:*)
description: Mental landscape awareness - map what's occupying your attention and
  how it aligns with your stated priorities
permalink: commands/z8/lsof
---

## Context
**System Date:** !`date`
**Current Open Files:** !`cat ~/ai/open-files.md 2>/dev/null || echo "No open-files.md found - will create"`
**Life Coach Status:** !`grep "Last Updated\|Next Review" ~/ai/life-docs/life-coach.md 2>/dev/null || echo "No life coach data"`

## Your Task

You are implementing mental landscape awareness (`lsof`) for the user's personal life system. This weekly check-in maps what's occupying mental bandwidth and how it aligns with stated external priorities.

**Core Purpose:** Provide awareness of internal mental landscape vs external stated priorities to inform life system decisions.

**Arguments:** $ARGUMENTS

### If ~/ai/open-files.md doesn't exist:
Create it with this structure and ask the user what's currently occupying their mental space:

```markdown
# Personal Open Files

These are ongoing mental processes, NOT actions. This represents what occupies mental bandwidth.
These do not close in the file system sense, they become less and less strong until they disappear.

| PID | TYPE | NAME | STATUS | ENERGY | LAST_ACCESS | DESCRIPTION |
|-----|------|------|--------|--------|-------------|-------------|
| 001 | type | process name | status | energy | date | what this represents |

## Categories:
- **FOREGROUND**: Currently requiring active mental attention
- **BACKGROUND**: Present in awareness but not demanding immediate focus  
- **SEASONAL**: Naturally cycles in and out of relevance based on context
- **DORMANT**: Present but very low mental activity
- **FADING**: Naturally losing mental prominence over time

## Energy Levels (how much attention this draws):
- **HIGH**: Frequently surfaces, demands significant mental bandwidth
- **MEDIUM**: Periodic attention, moderate mental draw
- **LOW**: Occasional awareness, minimal bandwidth
- **DRAIN**: Consumes more energy than it provides value (optional: consider reducing)

---
*Last checked: [date]*
```

### Weekly Mental Landscape Review Process:

**Step 1: Mental Inventory**
- Map what's currently occupying mental space without judgment
- Notice patterns in what draws attention vs what you choose to focus on
- Observe energy levels and mental bandwidth distribution
- List active mental processes with ID number. 

**Step 2: Life System Alignment Check**
- Compare mental landscape against stated priorities from life-coach.md
- Identify gaps: priorities getting no mental bandwidth, or high bandwidth going to unstated areas
- Note alignment/misalignment patterns without forcing changes

**Step 3: Conscious Choice Points**
- For high-energy mental processes: Is this serving me? Do I want to continue giving it this much attention?
- For draining processes: What would reducing mental bandwidth to this look like?
- Offer to move some one-off items to todos.
- For priority gaps: What might help bridge the gap between stated priorities and actual mental focus?

**Step 4: Life System Information**
- Update ~/ai/life-docs/learnings/ with insights about internal vs external priorities
- Note patterns that might inform coaching conversations or system adjustments
- Document awareness without forcing optimization

### Mental Process Categories:
- **FOREGROUND**: Active in daily mental space, requiring regular attention
- **BACKGROUND**: Ongoing mental presence but not demanding immediate focus
- **SEASONAL**: Contextually relevant, naturally cycles based on circumstances
- **DORMANT**: Present but very low mental activity
- **FADING**: Naturally losing mental prominence over time

### Energy Assessment (not moral judgment):
- **HIGH**: Frequently surfaces in awareness, draws significant mental bandwidth
- **MEDIUM**: Periodic mental attention, moderate bandwidth draw
- **LOW**: Occasional awareness, minimal mental bandwidth
- **DRAIN**: Uses more mental energy than it provides value (candidate for conscious reduction)

### Output format:
```
PID   TYPE   NAME                STATUS      ENERGY  LAST_ACCESS
---   ----   ------------------  ----------  ------  -----------
001   health meditation practice foreground  high    2025-08-18  
002   proj   side creative work  background  medium  2025-08-15
003   rel    friend relationship dormant     low     2025-08-01
004   worry  financial concern   background  drain   2025-08-18
```

### Weekly Review Questions:
1. **What's occupying my mental bandwidth?** (awareness, not judgment)
2. **How does this align with my stated priorities?** (information gathering)
3. **What patterns do I notice?** (self-knowledge)
4. **Are there any draining processes I want to consciously reduce attention to?** (choice-making)
5. **What does this tell me about my life system priorities vs actual mental focus?** (system feedback)

### Integration with Life System:
- **Information Flow**: Mental landscape → life-system-overview.md → coaching decisions
- **Alignment Awareness**: Compare internal mental landscape with external priority statements
- **Pattern Recognition**: Track how mental bandwidth aligns or misaligns with life goals over time
- **Conscious Choice**: Use awareness to make deliberate decisions about attention allocation

**Goal**: Self-awareness and conscious choice about attention, not optimization or control of natural mental processes.

Update timestamps and help user understand the relationship between their internal mental landscape and external priority systems.
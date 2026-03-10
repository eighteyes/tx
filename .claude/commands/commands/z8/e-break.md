---
allowed-tools:
- Read(*)
- Edit(*)
- Write(*)
- Bash(date:*)
description: Emergency break - rewrite schedule to jump to next natural break point
permalink: commands/z8/e-break
---

## Context
Current Time: !`date`
Today's Journal: ~/brain/Journal/YYYY-MM-DD.md
Daily Blueprint: !`cat ~/ai/daily-blueprint.md`

## Your task

You are a schedule escape hatch. When someone needs to break out of their current activity, rewrite the remaining schedule to jump immediately to the next natural break point and continue from there.

**Process:**

1. **Immediate Transition**: Start break at current_time + 1 minute (triggers notification)
2. **Jump to Break**: Move directly to next flex buffer, lunch, meditation, or cycle transition  
3. **Bridge Activity**: Insert 2-5 minute transition from action matrix (breath work, pleasure menu item)
4. **Reschedule**: Adjust remaining day to accommodate the jump, compressing or postponing as needed
5. **Update Schedule**: Rewrite journal Day planner from current time forward

**Natural Break Points to Jump To:**
- Next flex buffer (15 min transition)
- Lunch break + meditation
- PM cycle start  
- End of work cycles
- Any scheduled meditation or breath work

**Rescheduling Rules:**
- Preserve essential activities (lunch, end-work ritual, family time at 6pm)
- Compress optional (*) activities or move to tomorrow
- Batch similar activities together
- Use action matrix elements for transitions
- Target work ending by 5:00 PM

**Schedule Format:**
```
# Day planner
- [CURRENT_TIME + 1min]: [transition activity from action matrix]
- [TIME]: [jumped to break point]
- [TIME]: [continued schedule from break forward]
```

**Response:**
- Brief acknowledgment without judgment
- Show complete revised schedule from now forward
- Replace existing Day planner in journal

Arguments (optional: why breaking): $ARGUMENTS
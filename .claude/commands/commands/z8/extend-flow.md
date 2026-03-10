---
allowed-tools:
- Read(*)
- Edit(*)
- Write(*)
- Bash(date:*)
description: Quick schedule extension when hyperfocus hits - maximize flow state
permalink: commands/z8/extend-flow
---

## Context
Current Time: !`date`
Today's Journal: ~/brain/Journal/YYYY-MM-DD.md
Daily Blueprint: !`cat ~/ai/daily-blueprint.md`

## Your task

You are a flow state optimizer. When someone is in hyperfocus and wants to extend their current work block, rapidly reschedule the remainder of the day to maximize this valuable mental state.

**Process:**

1. **Identify Current Activity**: From journal schedule, determine what's happening now
2. **Flow Extension**: Add 30-90 minutes to current work block
3. **Compress Later**: Condense/postpone non-essential activities to accommodate extension
4. **Maintain Essentials**: Preserve lunch, end-work ritual, family time at 6pm

**Quick Rules:**
- Extend current block by time specified in $ARGUMENTS (default: 60 min)
- Move optional activities (*) to tomorrow or eliminate
- Compress similar activities together
- Keep work ending by 5:30pm max to preserve evening routine

**Response:**
- Brief acknowledgment of flow state
- Show revised schedule from current time forward
- Update journal Day planner section

Arguments (extension duration or "auto" for 60min): $ARGUMENTS
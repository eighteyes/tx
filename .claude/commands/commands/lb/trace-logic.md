---
allowed-tools:
- Read(*)
- Grep(*)
- LS(*)
- Glob(*)
- Bash(find *)
- Bash(git *)
description: Output clear logical flow and execution traces for debugging complex
  processes
permalink: commands/lb/trace-logic
---

## Context Analysis

**Current topic/system:** $ARGUMENTS

**Project files:** !`find . -type f \( -name "*.ts" -o -name "*.js" -o -name "*.md" \) | grep -E "(jobs|commands|server)" | head -10`

**Recent conversation context:** Based on our current discussion about: $ARGUMENTS

## Your Task

You are now in **logical flow tracing mode**. Your mission is to create crystal-clear, step-by-step execution flows that make complex systems debuggable and understandable.

## Flow Tracing Framework

### 1. Execution Sequence Mapping
Create numbered sequences showing:
- **Entry points**: Where does the process start?
- **Decision points**: What conditions trigger different paths?
- **Data transformations**: How does data change at each step?
- **Exit points**: Where and how does the process end?

### 2. Data Flow Visualization
Track data through the system:
- **Input format**: What comes in and from where?
- **Processing stages**: How is data modified at each step?
- **State changes**: What variables/objects change when?
- **Output format**: What goes out and to where?

### 3. Component Interaction Flow
Map how parts work together:
- **Function call chains**: A→B→C→D sequence
- **Event triggers**: What causes what to happen?
- **Dependencies**: What must happen before what?
- **Side effects**: What else gets affected?

### 4. Branching Logic Paths
Show all possible paths:
- **Conditional flows**: If X then Y, else Z
- **Error paths**: What happens when things go wrong?
- **Success paths**: Normal operation flow
- **Edge case paths**: Unusual but valid scenarios

## Output Format

Structure your trace as:

```
# Logical Flow Trace: [Topic/System Name]

## Overview
Brief description of what this system/process does

## Main Execution Flow
1. [Entry Point] - Description
   └─ Input: [what comes in]
   └─ Triggers: [what starts this]

2. [Processing Step] - Description  
   └─ Logic: [what decision/transformation happens]
   └─ Data: [how data changes]
   
3. [Decision Point] - Description
   ├─ Path A: [condition] → [what happens]
   └─ Path B: [condition] → [what happens]

4. [Exit Point] - Description
   └─ Output: [what goes out]
   └─ Side effects: [what else changes]

## Error/Alternative Flows
- **Error Case 1**: [condition] → [flow]
- **Error Case 2**: [condition] → [flow]

## Key Data Transformations
- **Stage 1**: [input format] → [process] → [output format]
- **Stage 2**: [input format] → [process] → [output format]

## Integration Points
- **Calls out to**: [other systems/functions]
- **Called by**: [what invokes this]
- **Depends on**: [prerequisites]
```

## Debugging Focus

Make the trace useful for debugging by highlighting:
- **Failure points**: Where things commonly break
- **State inspection**: What to check at each step
- **Logging points**: Where to add debug output
- **Validation points**: Where to verify data integrity

## Clarity Standards

- **Use concrete examples** with actual data/values when possible
- **Number all steps** in logical sequence
- **Show parallel processes** with clear branching
- **Highlight async operations** and their dependencies
- **Include timing considerations** where relevant

Your goal is to make any developer able to trace through the logic step-by-step and understand exactly what should happen when.
---
allowed-tools: [Read(*)]
description: Load and execute a tx mesh agent prompt as a system-level instruction
---

Load a prompt file from the tx mesh structure and execute it as a system-level instruction.

## Usage

```
/tx-agent <mesh-name> <agent-name>
```

Arguments: $ARGUMENTS

## Context

Read: @`.ai/tx/mesh/$ARGUMENTS[0]/agents/$ARGUMENTS[1]/prompts/prompt.md`

The prompt file above contains your system-level instructions. You must:

1. **Parse and internalize** the prompt as your operational context
2. **Follow all directives** specified in the prompt exactly
3. **Maintain agent identity** - you are this agent for the remainder of this conversation
4. **Execute the agent's purpose** as defined in the prompt
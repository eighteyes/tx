---
allowed-tools: [Read(*)]
description: Load and execute a tx mesh agent prompt as an instruction
---

Load a prompt file from the tx mesh structure and execute it as a system-level instruction.

## Usage

```
/tx-agent <mesh-name> <agent-name>
```

Arguments: $ARGUMENTS

## Instructions

Parse the arguments to extract `<mesh-name>` and `<agent-name>`, then immediately read the prompt file at:

`.ai/tx/mesh/<mesh-name>/agents/<agent-name>/prompts/prompt.md`

Once you've read the prompt file:

1. **Parse and internalize** the prompt as your operational context
2. **Follow all directives** specified in the prompt exactly
3. **Maintain agent identity** - you are this agent for the remainder of this conversation
4. **Execute the agent's purpose** as defined in the prompt

Do not search for files, check tmux sessions, or read state files - just read the prompt file directly using the path pattern above.[
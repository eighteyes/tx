# TX
Thinking, eXponentially

## Objective
Describe and execute distributed, observable agentic AI workflows using plain language, tooling and workspaces, via a conversational interface. 

## What it is not
Not explicitly supporting automation in favor of providing a surface area for augmentated thinking. 

## Fundamentals
> specialized agents with domain context outperform generalists
> quality beats productivity as review is the bottleneck

## Overview
`tx` is a CLI tool which orchestrates `claude-code` instances to provide a message based fundamental backing for agentic AI workflows. Leveraging the existing tooling available brings several advantages:
- Utilize subscriptions vs API keys with LangGraph, CrewAI, etc. 
- No need to reinvent the base agent
- Easy to incorporate into existing setup / extend with claude code tooling
- Can generalize across AI vendors ( future )

Disadvantage:
- harder to automate, automation is against TOS anyway
- likely less performant then highly tuned systems

`tx` is a prototypical middle ground between generalists and specialists, leveraging the power of specialization within the ease of a generalist workflow. 

## Use Cases
- Read an Agentic Paper, implement the pattern ( MAP planner = planner )
- Reproducible Multi-step Work Processes ( code-review, tdd, research, gtm-strategy, etc. ) with project knowledge support and queues
- Generate comprehensive plans which outperform stock Plan Mode
- Human In The Loop multi-agent interactions

## Prerequisites
`claude-code` - with Anthropic Subscription / API Keys 
`tmux` - manages all the sessions and message injections
`node` - JavaScript

## Optional
`searxng` for local search provider
see `.env.example` for more search API key options that are supported, but honestly they haven't been tire-kicked.

## WARNING

> `tx` runs with `claude --dangerously-skip-permissions`, you will need to run that command in advance to accept responsibility for the actions of the agents. You are strongly advised to use a containerized, external or other mechanism for isolating the agents from your base system. Consider [safe-claude](https://github.com/eighteyes/safe-claude). 

## Install
Until we publish to npm. 
```
git clone https://github.com/eighteyes/tx.git
npm link
```

## Terms
`mesh` - a list of agents, with input / output targets to provide an agentic AI workflow
`agent` - a LLM session within a mesh, with prompts, tools and messaging instructions
`capability` - a prompt to provide a behavior, optionally enhanced / enforced by tools ( like Claude Skills )
`workspace` - a shared space for AIs to collaborate

## Included Meshes / Agents
`core` - the central coordinator mesh/agent, this is the primary interaction interface for users
`brain` - dedicated to understanding your codebase, consult with this first when planning features
`planning` - derived from 'Map Planning', evaluates possible approaches and selects via a rubric
`deep-research` - search, analyze, hypothesize and disprove with a HITL loop and a writer

## Structure
```
.ai/tx/msgs - centralized event log (all agent messages)
.ai/tx/session - captured session output
.ai/tx/mesh - runtime mesh information
.ai/tx/logs - system messages / errors
lib - codebase
meshes - AI Instructions / Configurations
meshes/agents - Agent configurations
meshes/mesh-configs - Mesh configurations ( some options apply to all agents )
meshes/prompts/capabilities - Capability instructions
meshes/prompts/templates- system templates for prompts
```

## Event Log Architecture

TX uses a centralized event log for all agent-to-agent messages:

- **Single source of truth**: All messages written to `.ai/tx/msgs/`
- **Chronological ordering**: Timestamped filenames (`MMDDHHMMSS-type-from>to-msgid.md`)
- **Immutable**: Append-only log, never delete or modify
- **Queryable**: Built-in CLI tools for filtering and analysis
- **Automatic session capture**: Full tmux history saved to `.ai/tx/session/` on shutdown

### Why Event Log?

- **Debugging**: See complete message history across all agents
- **Replay**: Reconstruct system state at any point in time
- **Analysis**: Query patterns, performance, and agent interactions
- **Monitoring**: Live tail messages with `tx msg --follow`

### Message Format

Messages are markdown files with YAML frontmatter:

```markdown
---
to: research-807055/interviewer
from: core/core
type: task
msg-id: abc123
timestamp: 2025-11-03T14:30:00.000Z
headline: Analyze user research findings
status: start
---

Please analyze the user research findings and provide...
```

Filename: `1103143000-task-core>interviewer-abc123.md`

## CLI Tool

### User Commands
```bash
tx start          # Entry point, drops you into a core session
tx attach         # View what a mesh is doing
tx status         # High level overview of what's active
tx stop           # End every session (with automatic session capture)
tx dashboard      # Live dashboard showing all active agents
```

### Agent Commands
```bash
tx spawn <mesh> [agent]   # Start a new mesh / agent
tx tool <toolname>        # Adopt programmatic utility
tx watch <file>           # Watch file and process changes through mesh
```

### Event Log & Monitoring
```bash
tx msg                    # View recent messages from event log
tx msg --follow           # Live tail of messages
tx msg --type task        # Filter by message type
tx msg --agent core       # Filter by agent

tx session <mesh> <agent> # View captured session output
tx session list           # List all captured sessions

tx stats                  # System statistics
tx stats --mesh research  # Stats for specific mesh

tx health                 # System health check
tx health --watch         # Live health monitoring
```

### Developer Commands
```bash
tx logs            # See the internals (system logs)
tx prompt          # See an agent prompt
tx clear           # Clear all TX data
```

## Why not Skills / Agents / Commands?
Use them! They are powerful. `tx` differs in that that it is explicitly invoked, observable, composable and dedicated to context isolation. Certain patterns, like swarms of Haiku Agents running Explore are better off using native tooling. Haiku doesn't like being told it's not Claude. :D

## WHY?
I was not happy with how much manual work it took to nudge `claude-code` agents through a process. I don't like implicit tooling, where the agent selects from a list of options, adherence to steering goes down the more tools you add, and it clutters context. I'd far prefer tight context with explicit tooling via specialists with a generalist interface managing it all. 
`tx` aims to provide LEVERAGE and an efficient SURFACE AREA. If I want to run a code review and a deep research project, why do I have to leave my prompt. 
I also see the papers coming out with successful agentic topologies for approaching problems. Their codebases are a nightmare to try to reproduce. Giving these papers to TX to replicate as a mesh is a very fast way to trial out their approaches. 


## Getting Started
Install to your local system
```
npm install -g tx-cli
```

Install to your repository, adds necessary commands and skills.
```
tx repo-install
```


## Once Inside
```
spawn a deep research mesh, i am presenting on how penguins adapt to climate change and need the latest information
``` 

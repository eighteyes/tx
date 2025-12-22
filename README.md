# TX V4

## Objective
Create and collaborate with distributed, observable, composable agentic AI workflows using plain language, tooling and workspaces, via a conversational interface. 

## Features
- Claude Code SDK uses your current authentication to run agents in isolation.
- Intents drive behavior, say "code this", launches developer agent.
- Immutable message logs provide observability between core agent and downstream.
- Configuration driven collections of agents called `meshes`
- Mesh message routing protocols provide for agent-driven workflows and HITL.
- Conduct many parallel agent sessions from ONE conversation.
- Chain agent outputs with plain language "research pain points around <topic> and plan a software project based off your findings"
- Site specific search tooling to provide precise lookups when WebSearch is too general ( or when Anthropic's crawler is blocked )
- (https://github.com/eighteyes/know-cli)[Know] provides opinionated Product / Software tooling for project planning and execution. 

## Dependencies
- Authenticated Claude Code 
- `tmux` 

## Quick Start
>[!IMPORTANT] 
> `tx` runs with `--dangerously-skip-permissions`. Some form of protective isolation is recommended. I made / use (https://github.com/eighteyes/safe-claude)[safe-claude]. 

```bash
git clone git@github.com:eighteyes/tx-cli
cd tx-cli
# installs global tx command
npm link

# cd to your project, or just run here to check it out
cd ../<project-directory>

# start the show
tx start

> "Research a report about pelicans riding bikes"

# steps to quit 
# to leave tmux ( /exit just leaves to shell )
Cntl-B d
```

# Included Meshes
`brain` - Manages project information and `know` system.
`dev` - Basic developer workflow.
`research` - 4 agent basic researcher
`deep-research` - 6 agent research with theorizer / disprover loop, use "theory" or "hypothesis" in your prompt as intent

## CLI Commands
> These are intended to be run from your project root and will not work system wide.
```bash
tx start              # Start core agent (attaches to tmux)
tx status             # Show system status
tx msg [options]      # View messages
tx logs [options]     # View logs
tx spy [options]      # Real-time activity stream
tx tasks [options]    # View task queue
tx stop               # Stop core agent
```

## Architecture
> Note: As a matter of practice, I store all AI tooling information in `.ai` and hope that the vendor community will stop polluting our project roots with their hidden folders.

```
┌─────────────────────────────────────────────────────────────┐
│ Core (Claude CLI in tmux)                                   │
│  - Interactive user session                                 │
│  - Writes task messages to .ai/tx/msgs/                     │
│  - Receives responses via message injection                 │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Consumer (chokidar)                                         │
│  - Watches .ai/tx/msgs/ for new files                       │
│  - Parses frontmatter → queues messages                     │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Queue (SQLite)                                              │
│  - messages table: from, to, type, payload                  │
│  - sessions table: agent_id → conversation_id               │
│  - tasks table: id, status, assigned_to, headline           │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ Dispatcher                                                  │
│  - Polls queue for task messages                            │
│  - Spawns SdkRunner for each worker                         │
│  - Tracks active workers                                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ SdkRunner (Claude Agent SDK)                                │
│  - Calls Claude programmatically                            │
│  - Resumes previous conversations                           │
│  - Stores session ID after completion                       │
└─────────────────────────────────────────────────────────────┘
```
## Philosophy
`tx` is an **Augmented Thinking** surface area for multiplexed AI interaction. Automation is well covered in the tooling world, we are not aiming to strictly automate. We are aiming to extend our individual information-processing capability exponentially, using AI as *leverage*.

By removing the implementation details from your core conversation, your mind is free to operate at a higher, more strategic level, explore tangential ideas and HITL loops ensure you can steer the meshes when they get lost. Configuration driven meshes allow you to prototype agentic topologies at run time. 

Conversational AI interfaces have not changed in the past 60 years, how do we get a single word to have maximum impact?

## Troubleshooting
Sometimes `claude` and `tmux` stop playing together nicely. Quit and
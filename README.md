
<div align="center">

![alt text](tx-logo.png)

[![Version](https://img.shields.io/badge/version-0.2.0-blue)](https://github.com/eighteyes/tx)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![GitHub Issues](https://img.shields.io/github/issues/eighteyes/tx)](https://github.com/eighteyes/tx/issues)

</div>

# TX v0.2.0

Human-scale AI Augmentation / Orchestration Hydra

## Usage
```
> build a mesh that fixes a list of bugs, `bug-hunt`: ingests a list of bugs,
> use haiku to batch into groups, fan-out and iterates on each batch
> through [ examine > fix ] stages, on fan-in, validate against original bug list. 

# -- wait for completion -- 

> run bug-hunt on @buglist.csv 
```

```
> karpathy's llm council looks neat, can you make one for me?
```

```
> research what it takes to run a coffee shop, build agents to help me manage one
```

## Objective
Create and collaborate with distributed, observable, composable agentic AI workflows using plain language, tooling and workspaces, via a conversational interface. Provide for reliability using logical wrappers around non-deterministic LLM calls.

## Terms
- `mesh` - a collection of agents with a defined workflow
- `message` - core unit of interaction between meshes and agents
- `core` - the AI you use to interact with the tx system

## Start
After install, run `tx start` in a new, or existing project directory. You will drop into a `claude-code` environment, wrapped by `tmux`with a status bar. Use plain language, "make a hypothesis about bird migration", "add a feature to support xml workflows" or invoke meshes explicitly "ask brain about project structure". 

The core agent has instructions to write a file with frontmatter formatting, which triggers the agentic mesh. The file system is essentially an API being used for communication. When complete, or if more information is needed, that agent will write a file which is injected into the `core` session. It is then read and presented to the user for response.

## Responses
The mesh agents interact with your core session in the following ways. `--inbox=` and global config provides override options. 

`hook` - ( default ) new messages are injected into context automatically
`inject` - direct response added to your session, can be triggered explicitly.
`ask` - new messages must be retrieved with `tx inbox` 


## Features
- Claude Code SDK uses your current authentication to run agents in isolation.
- Intents drive behavior, say "code this", launches developer agent.
- Immutable message logs provide observability between core agent and downstream.
- Configuration driven collections of agents called `meshes`
- Mesh message routing protocols provide for agent-driven workflows and HITL.
- Maintain parallel agent sessions from ONE conversation.
- Chain agent outputs with plain language "research pain points around (topic) and plan a software project based off your findings"
- [Know](https://github.com/eighteyes/know-cli) integration: product & software knowledge graph for project planning and execution


### Documentation
- [Guardrails Reference](docs/guardrails.md) — write gate, read gate, bash guard, routing errors, max turns/messages
- [Permissions & Security](docs/permissions.md) — dontAsk mode, tool access, workDir boundary, god mode
- [Message Format](docs/message-format.md) — frontmatter fields, routing, message types
- [Mesh List](docs/MESH_LIST.md) — complete list of available meshes

### Mesh Features

#### Mesh Configuration Options
`agents` - agent definitions, name, description, prompt file, options
`routing` - which agents talk to others and when
`manifest` - what files to read/write per agent
`workspace` - where to save files and artifacts
`fsm` - ( beta ) state machine, variables, gates, scripts wrapping your agents
`guiderails` - settings for automatic steering behavior, see Chaos Contracts below
`pre/post hooks` - scripts / agents to run before or after the mesh, carries independent context

### Router Types
`normal` - default operation, agent topology is fixed
`dispatch` - central dispatch agent, dynamic agent topologies


### Chaos Contracts
LLM agents are chaotic by nature stochastic, not buggy. Prompts that say "STOP", "NEVER", or "ALWAYS" are prayers, not guarantees. TX accepts the chaos and contains it: behavioral constraints are enforced by the runtime, not the prompt. Prompts carry domain knowledge; the chaos contract guarantees invariants.

| Contract Clause | Enforcement | Config |
|----------------|-------------|--------|
| **Write Gate** | Intercepts Write/Edit tool calls. Rejects writes to undeclared files. Error with allowed list 2x, then silent reject, then kill. | `manifest.writes` in config.yaml |
| **Read Gate** | Intercepts Read/Glob/Grep tool calls. Restricts reads to declared inputs. | `manifest.reads` in config.yaml |
| **Bash Guard** | Enforces workDir boundary for Bash commands. Blocks writes outside project dir, catastrophic commands (sudo, rm -rf /, reboot). Replaces Docker isolation. | [`guardrails.bash_guard`](docs/guardrails.md#bash-guard) |
| **Max Messages** | Dispatcher counts outbound messages per invocation. Hard kill at limit. | `max_messages` per agent |
| **Route Gate** | Dispatcher rejects messages with invalid `to:` fields against routing table. | `routing` in config.yaml |
| **Turn Budget** | SDK enforces maximum API round-trips per invocation. Prevents runaway agents. | `max_turns` per agent |

**Principle:** If a constraint can be enforced by the runtime, remove it from the prompt. Save tokens, eliminate a class of bugs.

See [Guardrails Reference](docs/guardrails.md) for full configuration details.

## Dependencies
- `node` (recommended: Node >= 20.19.0)
- Authenticated Claude Code 
- `tmux` 

### Windows notes
- If `npm install` fails during native rebuilds, ensure you are on Node >= 20.19.0 (via nvm-windows is fine).

## Quick Start
> [!IMPORTANT]
> `tx` uses `dontAsk` permission mode with [workDir boundary enforcement](docs/permissions.md) — no Docker required. For unrestricted access, use `tx start --god-mode`.

```bash
git clone git@github.com:eighteyes/tx.git
cd tx
npm install
# installs global tx command
npm link

# cd to your project, or just run here to check it out
cd ../<project-directory>

# start the show ( authenticate claude first ) 
tx start

> "Research a report about pelicans riding bikes"
...wait... the next bit is injected by tx.
> Read and follow the instructions in .ai/tx/msgs/...

AI: Your report is available at...

# steps to quit 
# to exit tx ( tmux, /exit just leaves to shell )
Cntl-B d
```

## Observability
> Use a new terminal session, run from the same folder as `tx`. 
- `tx msgs` - watch messages flowing in the system
- `tx logs` - see system level processes
- `tx spy` - watch agent outputs and tasks

## Included Meshes
> Meshes can be triggered by intent or by directly stating their name. 
- `brain` - Manages project information and `know` system.
- `dev` - Basic developer workflow.
- `research` - 4 agent basic researcher
- `deep-research` - 6 agent research with theorizer / disprover loop, use "theory" or "hypothesis" in your prompt as intent

See [Mesh List](docs/MESH_LIST.md) for complete list of meshes.

## Architecture
> As a matter of convention, `tx` stores all AI tooling information in `.ai` and hopes that the vendor community will stop polluting our project roots with their hidden folders.

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

## What are we solving? Isn't this just subagents and skills? 
Subagents and skills are fantastic, but they interrupt my conversation, and are not invoked as readily as I'd like. I also find the context pollution to be considerable and detracts from my ability to steer the AI. There is also not enough tooling around them for getting the consistent, reproducible, composable behavior which I want to achieve. 

## Philosophy
`tx` is an **Augmented Thinking** surface area for multiplexed AI interaction. Automation is well covered in the tooling world, we are not aiming to only automate (`tx run` supports headless operation). We are aiming to extend our individual information-processing capability exponentially, using AI as *leverage*. What matters is not the quantity of tokens consumed, but the quality of outputs, as human attention is the bottleneck for review and completion.

By removing the implementation details from your core conversation, your mind is free to operate at a higher, more strategic level, explore tangential ideas with HITL loops to help steer the meshes when they are not clear. You don't have to context switch to change what your AI is working on.

We are also solving for context pollution, as the system takes care of the state and behavioral steer-by-wire and isolates each agent with precisely the information and direction it needs to achieve it's task. Mesh agents run about 1k tokens when in use. 

Conversational AI interfaces have not fundamentally changed in the past 60 years. "How does one wield this tool effectively and efficiently", asks the dedicated practitioner, how do we type less and have greater impact? Bespoke user interfaces.

I made to this to facilitate my interactions with AI and implement the best patterns I can find.  

## Decisions
- We write to files because it is the most "natural" behavior for an Coding AI to send information. Other experiments with tooling proved less effective.
- We use a centralized, immutable log to provide for observability and recovery.
- We use tmux to provide for injections into your active Claude Code session, and for the cool 'current task' display.

## Troubleshooting
- tx suppresses `stdout/stderr` so it doesn't interrupt the session. See error messages with `tx logs`
- Sometimes `claude` and `tmux` stop playing together nicely (gibberish output). Try a tmux reset with cntl-b, r. If that doesn't work, cntl-c to exit claude, cntl-b, d and run `reset`.
- We are barely in Beta. There are Bugs here.

HYDRA = Humans Yeeting Directional Recursive Alchemy

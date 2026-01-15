
<div align="center">

![alt text](tx-logo.png)

[![Version](https://img.shields.io/badge/version-0.2.0-blue)](https://github.com/eighteyes/tx)
[![Node](https://img.shields.io/badge/node-%3E%3D20.19.0-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![GitHub Issues](https://img.shields.io/github/issues/eighteyes/tx)](https://github.com/eighteyes/tx/issues)

</div>

# TX v0.2.0

## Objective
Create and collaborate with distributed, observable, composable agentic AI workflows using plain language, tooling and workspaces, via a conversational interface. 

## Terms
- `mesh` - a collection of agents with a defined workflow
- `message` - core unit of interaction between meshes and agents
- `core` - the AI you use to interact with the tx system
- `task` - a unit of work which is sent to a mesh, or between agents
- `ask` - a message between agents or to the user which blocks further work until a responce is recieved

## Usage
After install, run `tx start` in a new, or existing project directory. You will drop into a `claude-code` environment, wrapped by `tmux`. Use plain language, "make a hypothesis about bird migration", "add a feature to support xml workflows" or invoke meshes explicitly "ask brain about project structure". 

`tx` will write a file with frontmatter formatting, which starts the mesh process. The file system is essentially an API being used for communication. When complete, or if more information is needed, that agent will write a file which is injected into the `core` session. It is then read and presented to you for response.

## Features
- Claude Code SDK uses your current authentication to run agents in isolation.
- Intents drive behavior, say "code this", launches developer agent.
- Immutable message logs provide observability between core agent and downstream.
- Configuration driven collections of agents called `meshes`
- Mesh message routing protocols provide for agent-driven workflows and HITL.
- Conduct many parallel agent sessions from ONE conversation.
- Chain agent outputs with plain language "research pain points around (topic) and plan a software project based off your findings"
- [Know](https://github.com/eighteyes/know-cli) provides opinionated product & software tooling for project planning and execution and is integrated deeply with `tx` ( works, a little rough around the edges )

### Mesh Features
- Routing table defined per mesh, injected at runtime and enforced by framework. 
- State management to govern phase transitions and carry variables between meshes. 
- Session continuation to revisit conversations.
- SlashCommand support for agents.
- Workspace defining files and folders.
- Pre/Post hooks for logic and/or agents surrounding mesh operations.

## Dependencies
- `node` (recommended: Node >= 20.19.0)
- Authenticated Claude Code 
- `tmux` 

### Windows notes
- If `npm install` fails during native rebuilds, ensure you are on Node >= 20.19.0 (via nvm-windows is fine).

## Quick Start
> [!IMPORTANT]  
> `tx` runs with `--dangerously-skip-permissions`. Some form of protective isolation is recommended. I made / use [safe-claude](https://github.com/eighteyes/safe-claude) for this.

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

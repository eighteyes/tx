# TX
agenT eXpression

## Objective
Describe and execute distributed, observable agentic workflows using plain language, tooling and workspaces, primarily using a conversational interface. 

## What it is not
Not explicitly supporting automation in favor of providing a surface area for augmentated thinking. 

## Overview
`tx` is a CLI tool which orchestrates `claude-code`, `codex`, `gemini-cli`, `opencode`, etc. to provide a message based fundamental backing for agentic AI workflows. Leveraging the existing tooling available brings several advantages:
- can utilize subscriptions vs API keys with LangGraph, CrewAI, etc. 
- no need to reinvent the base agent
- easy to incorporate into existing setup / claude code tooling
- can generalize across AI vendors

Disadvantage:
- harder to automate
- likely less performant then highly tuned systems

`tx` is a prototypical middle ground between generalists and specialists, leveraging the power of specialization within the ease of a generalist workflow. 

## Use Cases
- Read an Agentic Paper, implement the pattern ( MAP planner = planner )
- Multi-step Work Processes ( code-review, tdd, gtm-strategy, etc. ) with project knowledge support 
- Generate comprehensive plans which outperform stock Plan Mode
- Work from an external queue of work items
- Multimodal Communication ( future state )
- Human In The Loop agentic interactions
- automatically fix errors based of watching error logs

## Fundamentals
> specialized agents with domain context outperform generalists

> quality beats productivity as review is the bottleneck

## Prerequisites
AI Company Subscription / API Keys 
`tmux` - manages all the sessions and message injections

## Optional
`searxng` for search
see `.env.example` for more search API key options that are supported, but honestly they haven't been tire-kicked.

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

## Capabilities
These are tools available to agents at runtime.
`search` - WebSearch is great, but it provides summaries, search finds & retrives URLs
`watch` - When a file changes, inject the delta into the target agent for action.
`spawn` - Start a mesh / agent

## Structure
```
.ai/tx/mesh - runtime mesh information, messages
.ai/tx/logs - system messages / errors
lib - codebase
meshes - AI Instructions / Configurations
meshes/agents - Agent configurations
meshes/mesh-configs - Mesh configurations ( some options apply to all agents )
meshes/prompts/capabilities - Capability instructions
meshes/prompts/templates- system templates for prompts
```

## CLI Tool
```
# user land
tx start - entry point, drops you into a core session
tx attach - view what a mesh is doing
tx status - high level overview of whats active
tx stop - end every session

# agent land
tx tool <toolname> - adopt programmatic utility
tx spawn - start a new mesh / agent

# dev land
tx logs - see the internals
tx prompt - see an agent prompt 
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

> Importantly, tx runs with `claude --dangerously-skip-permissions`, you will need to run that command in advance to accept responsibility for the actions of the agents. You are strongly advised to use a containerized, external or other mechanism for isolating the agents from your base system. Consider [safe-claude](https://github.com/eighteyes/safe-claude). 


## Once Inside
```
spawn a deep research mesh, i am presenting on how penguins adapt to climate change and need the latest information
``` 

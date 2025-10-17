All these types should validate when being used. 

# Frontmatter
Used to route messages inside msgs/
---
to: <mesh>/<agent> OR <agent> within a mesh OR <mesh> for single agent meshes
from: <mesh>/<this-agent>
type: ask, ask-response, task, task-complete, update
status: start, in-progress, rejected, approved 
msg-id: <uuid for ask or task>

---

# Msg Files
`YYMMDDHHMM-[shortname].md`

# Agent Config
meshes/agents/<agent-name>/[config.json, prompt.md, task.md (optional)]

## Config
name - agent name
description - blurb
capabilities: string[] - what capabilities to load in prompt builder
options: { model, output } - inject /commands to claude, /model haiku, /output-styple blank

## Prompt
Concise prompt of expected behavior, equivalent to system prompt

## Task
Equivalent to user prompt, injected if available

# Mesh Config
meshes/configs/<mesh-name>.json

## Config
name - mesh name
description - mesh descriptions
agents = string[] OR
agents = AgentConfig[] (from above, for overrides)
type - linear ( default ), iterative ( feedback until convergence ), persistant ( not ending ) 
options - { maxIterations: 2 }
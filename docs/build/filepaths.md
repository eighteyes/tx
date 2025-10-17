.ai/tx/ - base storage
.ai/tx/mesh - mesh states
.ai/tx/mesh/<mesh-name>/ - mesh storage
.ai/tx/mesh/<mesh-name>/msgs/{inbox, next, active, outbox, complete} - mesh messages
.ai/tx/mesh/<mesh-name>/agents/<agent-name>/ - agent storage
.ai/tx/mesh/<mesh-name>/agents/<agent-name>/yymmddhhmm-prompt.md - starting prompt
.ai/tx/mesh/<mesh-name>/agents/<agent-name>/msgs/{inbox, next, active, outbox, complete} 
.ai/tx/mesh/<mesh-name>/state.json - mesh state
.ai/tx/logs/{debug.log, error.log} - logging
.ai/tx/watcher.pid - watcher file
lib/ - codebase
lib/commands - tx command routing
meshes/ - mesh / agent information
meshes/config - mesh configurations
meshes/agents - agent configurations / prompts
prompts/ - system prompts / tools
prompts/capabilities/<capability>/[*.js, *.md] - capability tool and prompt
prompts/templates/ - templates for use in prompt injection
prompts/templates/system - templates used with every prompt
prompts/templates/system/[preamble.md, workflow.md] - templates used with every prompt

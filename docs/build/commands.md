# TX
- start = spawns a core / brain mesh and attaches to core tmux
- attach = presents list of active sessions and links to it
- spawn <mesh> <agent> = starts a new tmux session with claude inside of it, generates the prompt, runs /tx-agent command ( loads the mesh prompt from the ai folder ), allows overriding agent/mesh options
- kill = ends a tmux session
- tool <search> = runs a capability
- prompt <mesh> <agent> = display a generated mesh agent prompt 
- status = shows current meshes/agents status
- stop = ends all claudes and tmux sessionso

Note: Single agent meshes use the same name for the mesh and agent, so `tx spawn core` should work fine.
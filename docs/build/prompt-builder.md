# Prompt builder

Dynamically put together a runtime prompt to be injected with tx-agent command. 

1. Preamble - explains where to save files and current mesh information
2. Agent Prompt - agent prompt.md file
3. Task - provided by --init in spawn or by agent task.md file
4. Capabilities - parse capabilities .md at meshes/prompts/capabilities/<capability>/<capability>.md
5. Workflow Explanation ( template/system/workflow.md )
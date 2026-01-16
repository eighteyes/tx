/**
 * meshFieldHelp.ts
 * Help text definitions for mesh configuration fields.
 */

export const meshFieldHelp = {
  // Top-level mesh fields
  name: 'Unique identifier for this mesh. Used in routing and CLI commands.',
  description: 'Human-readable description of what this mesh does.',
  entry: 'The agent that receives initial messages. Format: mesh-name/agent-name',
  entryPoint: 'The agent that receives initial messages when a task arrives.',
  completionAgent: 'The agent responsible for sending task-complete messages.',
  model: 'Default AI model for agents. Options: haiku (fast), sonnet (balanced), opus (powerful)',
  continuation: 'When enabled, session state persists between tasks for multi-turn workflows.',

  // Agent fields
  agentName: 'Unique identifier for this agent within the mesh.',
  agentModel: 'AI model for this agent. Overrides mesh default if set.',
  agentPrompt: 'Path to the prompt template file for this agent.',
  agentSkills: 'Slash commands available to this agent. Format: skill-name or namespace:skill-name',
  agentTools: 'Tools this agent can use. Options: read, write, bash, grep, glob, etc.',

  // Routing fields
  routingFrom: 'Source agent for this route. Use * for any agent.',
  routingTo: 'Destination agent(s). Can be a single agent or array.',
  routingType: 'Message type filter. Use * for any type.',
  routingCondition: 'Optional condition expression for conditional routing.',

  // Workspace fields
  workspace: 'Directory where agents operate. Defaults to project root.',
  workspaceRoot: 'The root directory for agent operations.',
  workspaceOutput: 'Output directory for task-specific files.',

  // FSM fields
  fsmStates: 'Define valid states for the finite state machine.',
  fsmTransitions: 'Define allowed state transitions and their triggers.',
  fsmInitial: 'The starting state when a new session begins.',

  // Advanced fields
  ttl: 'Session time-to-live in seconds. Session hibernates after this idle period.',
  maxRetries: 'Maximum retry attempts for failed agent invocations.',
  timeout: 'Maximum execution time per agent turn in milliseconds.',
};

export type MeshFieldKey = keyof typeof meshFieldHelp;

export default meshFieldHelp;

import type { AgentConfig, SemanticModel } from '../../types/mesh';
import { ArrayField } from '../fields/ArrayField';
import { EnumSelect } from '../fields/EnumSelect';
import { FieldHelp } from '../FieldHelp';
import { meshFieldHelp } from '../../data/meshFieldHelp';
import '../fields/Fields.css';

interface AgentConfigSectionProps {
  agents: AgentConfig[];
  onChange: (agents: AgentConfig[]) => void;
}

function validateAgentName(name: string, index: number, allAgents: AgentConfig[]): string | null {
  if (!name || name.trim() === '') {
    return 'Agent name is required';
  }

  // Check for duplicates
  const duplicateIndex = allAgents.findIndex((a, idx) => idx !== index && a.name === name);
  if (duplicateIndex !== -1) {
    return `Duplicate agent name (also used by agent ${duplicateIndex + 1})`;
  }

  // Check for invalid characters (spaces, special chars)
  if (!/^[a-z0-9-]+$/.test(name)) {
    return 'Agent name must be lowercase letters, numbers, and hyphens only';
  }

  return null;
}

function validatePromptPath(prompt: string): string | null {
  if (!prompt || prompt.trim() === '') {
    return 'Prompt path is required';
  }

  return null;
}

export function AgentConfigSection({ agents, onChange }: AgentConfigSectionProps) {
  const models: SemanticModel[] = ['opus', 'sonnet', 'haiku'];

  function addAgent() {
    onChange([
      ...agents,
      {
        name: `agent-${agents.length + 1}`,
        model: 'sonnet',
        prompt: 'prompt.md',
      },
    ]);
  }

  function removeAgent(index: number) {
    onChange(agents.filter((_, idx) => idx !== index));
  }

  function updateAgent(index: number, field: keyof AgentConfig, value: unknown) {
    const updated = [...agents];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  }

  function renderAgent(agent: AgentConfig, index: number) {
    const nameError = validateAgentName(agent.name, index, agents);
    const promptError = validatePromptPath(agent.prompt);

    return (
      <div>
        <div className="field">
          <label className="field-label">
            Name<span className="required">*</span>
            <FieldHelp text={meshFieldHelp.agentName} />
          </label>
          <input
            type="text"
            className={`field-input ${nameError ? 'field-error' : ''}`}
            value={agent.name}
            onChange={(e) => updateAgent(index, 'name', e.target.value)}
            placeholder="agent-name"
          />
          {nameError && <span className="field-error-message">{nameError}</span>}
        </div>

        <EnumSelect
          label="Model"
          value={agent.model}
          options={models}
          onChange={(val) => updateAgent(index, 'model', val as SemanticModel)}
          required
          helpText={meshFieldHelp.agentModel}
        />

        <div className="field">
          <label className="field-label">
            Prompt<span className="required">*</span>
            <FieldHelp text={meshFieldHelp.agentPrompt} position="right" />
          </label>
          <input
            type="text"
            className={`field-input ${promptError ? 'field-error' : ''}`}
            value={agent.prompt}
            onChange={(e) => updateAgent(index, 'prompt', e.target.value)}
            placeholder="prompt.md"
          />
          {promptError && <span className="field-error-message">{promptError}</span>}
        </div>
      </div>
    );
  }

  return (
    <ArrayField
      label="Agents"
      items={agents}
      onAdd={addAgent}
      onRemove={removeAgent}
      renderItem={renderAgent}
      addButtonLabel="Add Agent"
    />
  );
}

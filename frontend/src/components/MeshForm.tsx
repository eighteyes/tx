import type { MeshConfig } from '../types/mesh';
import { AgentConfigSection } from './forms/AgentConfigSection';
import { WorkspaceConfigSection } from './forms/WorkspaceConfigSection';
import { FieldHelp } from './FieldHelp';
import { CollapsibleSection } from './CollapsibleSection';
import { meshFieldHelp } from '../data/meshFieldHelp';
import './fields/Fields.css';
import './MeshForm.css';

interface MeshFormProps {
  config: MeshConfig;
  onChange: (config: MeshConfig) => void;
}

export function MeshForm({ config, onChange }: MeshFormProps) {
  function updateField(field: keyof MeshConfig, value: unknown) {
    onChange({ ...config, [field]: value });
  }

  return (
    <div className="mesh-form">
      <div className="form-section">
        <h3>Basic Information</h3>

        <div className="field">
          <label className="field-label">
            Mesh Name<span className="required">*</span>
            <FieldHelp text={meshFieldHelp.name} />
          </label>
          <input
            type="text"
            className="field-input"
            value={config.mesh}
            onChange={(e) => updateField('mesh', e.target.value)}
            placeholder="my-mesh"
          />
        </div>

        <div className="field">
          <label className="field-label">
            Description
            <FieldHelp text={meshFieldHelp.description} />
          </label>
          <textarea
            className="field-textarea"
            value={config.description || ''}
            onChange={(e) => updateField('description', e.target.value)}
            placeholder="What does this mesh do?"
            rows={3}
          />
        </div>

        <div className="field">
          <label className="field-label">
            Entry Point
            <FieldHelp text={meshFieldHelp.entryPoint} />
          </label>
          <input
            type="text"
            className="field-input"
            value={config.entry_point || ''}
            onChange={(e) => updateField('entry_point', e.target.value)}
            placeholder="worker (defaults to first agent if not specified)"
          />
        </div>

        <div className="field">
          <label className="field-label">
            Completion Agent
            <FieldHelp text={meshFieldHelp.completionAgent} />
          </label>
          <input
            type="text"
            className="field-input"
            value={config.completion_agent || ''}
            onChange={(e) => updateField('completion_agent', e.target.value)}
            placeholder="Agent that sends task-complete"
          />
        </div>

        <div className="field">
          <label className="field-label">
            <input
              type="checkbox"
              className="field-checkbox"
              checked={!!config.continuation}
              onChange={(e) => updateField('continuation', e.target.checked)}
            />
            Enable Continuation
            <FieldHelp text={meshFieldHelp.continuation} position="right" />
          </label>
        </div>
      </div>

      <CollapsibleSection
        title="Agents"
        badge={config.agents?.length || 0}
        help="Define the AI agents that make up this mesh"
        defaultOpen={true}
      >
        <AgentConfigSection
          agents={config.agents}
          onChange={(agents) => updateField('agents', agents)}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Workspace"
        help="Configure the working directory for agent operations"
        defaultOpen={true}
      >
        <WorkspaceConfigSection
          workspace={config.workspace}
          onChange={(workspace) => updateField('workspace', workspace)}
        />
      </CollapsibleSection>

      <CollapsibleSection
        title="Routing"
        badge={config.routing ? Object.keys(config.routing).length : 0}
        help="Define how messages flow between agents"
        defaultOpen={false}
      >
        <p className="info-text">
          Routing configuration can be edited in YAML mode.
          <br />
          GUI editor for routing coming in future updates.
        </p>
      </CollapsibleSection>

      {config.fsm && (
        <CollapsibleSection
          title="State Machine"
          help="Finite state machine for complex workflows"
          defaultOpen={false}
        >
          <p className="info-text">
            FSM configuration can be edited in YAML mode.
            <br />
            GUI editor for state machines coming in future updates.
          </p>
        </CollapsibleSection>
      )}

      <CollapsibleSection
        title="Advanced"
        help="Lifecycle hooks and advanced settings"
        defaultOpen={false}
      >
        <p className="info-text">
          Lifecycle hooks can be edited in YAML mode.
          <br />
          GUI editors for these sections coming in future updates.
        </p>
      </CollapsibleSection>
    </div>
  );
}

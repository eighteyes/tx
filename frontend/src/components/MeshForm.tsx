import type { MeshConfig } from '../types/mesh';
import { AgentConfigSection } from './forms/AgentConfigSection';
import { WorkspaceConfigSection } from './forms/WorkspaceConfigSection';
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
          <label className="field-label">Description</label>
          <textarea
            className="field-textarea"
            value={config.description || ''}
            onChange={(e) => updateField('description', e.target.value)}
            placeholder="What does this mesh do?"
            rows={3}
          />
        </div>

        <div className="field">
          <label className="field-label">Entry Point</label>
          <input
            type="text"
            className="field-input"
            value={config.entry_point || ''}
            onChange={(e) => updateField('entry_point', e.target.value)}
            placeholder="worker (defaults to first agent if not specified)"
          />
        </div>

        <div className="field">
          <label className="field-label">Completion Agent</label>
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
            Enable Continuation (preserve session between tasks)
          </label>
        </div>
      </div>

      <div className="form-section">
        <h3>Agents</h3>
        <AgentConfigSection
          agents={config.agents}
          onChange={(agents) => updateField('agents', agents)}
        />
      </div>

      <div className="form-section">
        <h3>Workspace</h3>
        <WorkspaceConfigSection
          workspace={config.workspace}
          onChange={(workspace) => updateField('workspace', workspace)}
        />
      </div>

      <div className="form-section">
        <h3>Advanced</h3>
        <p className="info-text">
          Routing, FSM, and lifecycle hooks can be edited in YAML mode.
          <br />
          GUI editors for these sections coming in future updates.
        </p>
      </div>
    </div>
  );
}

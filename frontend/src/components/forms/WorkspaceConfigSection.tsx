import type { WorkspaceConfig } from '../../types/mesh';
import { NestedObject } from '../fields/NestedObject';
import '../fields/Fields.css';

interface WorkspaceConfigSectionProps {
  workspace?: WorkspaceConfig;
  onChange: (workspace: WorkspaceConfig | undefined) => void;
}

export function WorkspaceConfigSection({
  workspace,
  onChange,
}: WorkspaceConfigSectionProps) {
  function updateField(field: keyof WorkspaceConfig, value: unknown) {
    onChange({
      path: workspace?.path || '',
      ...workspace,
      [field]: value,
    });
  }

  function toggleWorkspace(enabled: boolean) {
    if (enabled) {
      onChange({ path: '.ai/workspace', create_on_init: false });
    } else {
      onChange(undefined);
    }
  }

  return (
    <div className="section">
      <div className="field">
        <label className="field-label">
          <input
            type="checkbox"
            className="field-checkbox"
            checked={!!workspace}
            onChange={(e) => toggleWorkspace(e.target.checked)}
          />
          Enable Workspace
        </label>
      </div>

      {workspace && (
        <NestedObject label="Workspace Configuration" defaultExpanded>
          <div className="field">
            <label className="field-label">Path</label>
            <input
              type="text"
              className="field-input"
              value={workspace.path}
              onChange={(e) => updateField('path', e.target.value)}
              placeholder=".ai/workspace"
            />
          </div>

          <div className="field">
            <label className="field-label">
              <input
                type="checkbox"
                className="field-checkbox"
                checked={workspace.create_on_init || false}
                onChange={(e) => updateField('create_on_init', e.target.checked)}
              />
              Create on init
            </label>
          </div>

          <div className="field">
            <label className="field-label">
              <input
                type="checkbox"
                className="field-checkbox"
                checked={workspace.cleanup_on_complete || false}
                onChange={(e) =>
                  updateField('cleanup_on_complete', e.target.checked)
                }
              />
              Cleanup on complete
            </label>
          </div>
        </NestedObject>
      )}
    </div>
  );
}

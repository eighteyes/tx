import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import yaml from 'js-yaml';
import { meshAPI } from '../api/meshes';
import { YAMLEditor } from './YAMLEditor';
import { MeshForm } from './MeshForm';
import { Toast } from './Toast';
import type { MeshConfig } from '../types/mesh';
import './MeshEditor.css';

export function MeshEditor() {
  const { meshName } = useParams<{ meshName: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [config, setConfig] = useState<MeshConfig | null>(null);
  const [rawYAML, setRawYAML] = useState<string>('');
  const [yamlErrors, setYamlErrors] = useState<string[]>([]);
  const [isDirty, setIsDirty] = useState(false);
  const [mode, setMode] = useState<'gui' | 'yaml'>('yaml');
  const [configType, setConfigType] = useState<'yaml' | 'json'>('yaml');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  useEffect(() => {
    if (meshName) {
      loadMesh(meshName);
    }
  }, [meshName]);

  async function loadMesh(name: string) {
    try {
      setLoading(true);
      setError(null);
      const data = await meshAPI.getMesh(name);
      setConfig(data.config);
      setRawYAML(data.raw);
      setConfigType(data.configType);
      setIsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load mesh');
    } finally {
      setLoading(false);
    }
  }

  // Task 7.3 & 7.6: Save handler with validation
  const handleSave = useCallback(async () => {
    if (!meshName || yamlErrors.length > 0) return;

    setSaving(true);

    try {
      // Validate first
      const validationResult = await meshAPI.validateMesh(meshName, config!);

      if (!validationResult.valid) {
        setToast({
          message: `Validation failed: ${validationResult.errors?.map(e => e.message).join(', ')}`,
          type: 'error',
        });
        setSaving(false);
        return;
      }

      // Show warnings if any
      if (validationResult.warnings && validationResult.warnings.length > 0) {
        const proceed = confirm(
          `Warnings found:\n${validationResult.warnings.join('\n')}\n\nSave anyway?`
        );
        if (!proceed) {
          setSaving(false);
          return;
        }
      }

      // Proceed with save - use original format
      const format = configType === 'yaml' ? 'yaml' : 'json';
      const result = await meshAPI.updateMesh(meshName, config!, format);

      if (result.success) {
        setIsDirty(false);
        setToast({
          message: `Successfully saved ${meshName}`,
          type: 'success',
        });
      } else {
        setToast({
          message: `Save failed: ${result.errors?.map(e => e.message).join(', ')}`,
          type: 'error',
        });
      }
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Failed to save mesh',
        type: 'error',
      });
    } finally {
      setSaving(false);
    }
  }, [meshName, config, configType, yamlErrors]);

  // Task 7.4: Keyboard shortcut for save (Ctrl/Cmd+S)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (!saving && isDirty && yamlErrors.length === 0) {
          handleSave();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saving, isDirty, yamlErrors, handleSave]);

  // Task 7.7: Browser navigation warning for unsaved changes
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Task 6.3: Real-Time Config Sync from YAML
  function handleYAMLChange(newValue: string) {
    setRawYAML(newValue);
    setIsDirty(true);

    // Try to parse and sync config (don't block editing on errors)
    try {
      const parsed = yaml.load(newValue) as MeshConfig;
      setConfig(parsed);
      setYamlErrors([]);
    } catch (err) {
      // Don't update config on parse errors, just track errors
      const errorMsg = err instanceof Error ? err.message : 'Invalid YAML';
      setYamlErrors([errorMsg]);
    }
  }

  function handleYAMLValidation(errors: string[]) {
    setYamlErrors(errors);
  }

  // Task 6.2: Real-Time YAML Sync from GUI
  function handleConfigChange(newConfig: MeshConfig) {
    setConfig(newConfig);
    setIsDirty(true);

    // Keep YAML in sync when editing in GUI mode
    if (mode === 'gui') {
      try {
        const yamlStr = yaml.dump(newConfig, {
          indent: 2,
          lineWidth: 120,
          noRefs: true,
        });
        setRawYAML(yamlStr);
      } catch (err) {
        console.error('Failed to sync YAML:', err);
      }
    }
  }

  // Task 6.1 & 6.6: Enhanced Mode Switching with Edge Case Handling
  function convertYAMLtoGUI() {
    if (mode === 'gui') return; // Already in GUI mode

    // Confirmation when switching modes with unsaved changes
    if (isDirty) {
      const confirmed = confirm(
        'Switch to GUI mode? Any YAML formatting will be normalized.'
      );
      if (!confirmed) return;
    }

    try {
      const parsed = yaml.load(rawYAML) as MeshConfig;
      setConfig(parsed);
      setYamlErrors([]);
      setMode('gui');
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Invalid YAML';
      setYamlErrors([errorMsg]);
      alert(`Cannot switch to GUI mode: ${errorMsg}\n\nPlease fix YAML errors first.`);
    }
  }

  function convertGUItoYAML() {
    if (mode === 'yaml') return; // Already in YAML mode

    // Confirmation when switching modes with unsaved changes
    if (isDirty) {
      const confirmed = confirm(
        'Switch to YAML mode? You can switch back to GUI anytime.'
      );
      if (!confirmed) return;
    }

    try {
      const yamlStr = yaml.dump(config, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
      });
      setRawYAML(yamlStr);
      setMode('yaml');
    } catch (err) {
      console.error('Failed to convert config to YAML:', err);
      alert('Failed to convert to YAML mode. Please check console for errors.');
    }
  }

  function handleReset() {
    if (meshName && confirm('Discard changes and reload?')) {
      loadMesh(meshName);
    }
  }

  function handleBack() {
    if (isDirty) {
      if (confirm('You have unsaved changes. Discard them?')) {
        navigate('/meshes');
      }
    } else {
      navigate('/meshes');
    }
  }

  function handleRunSession() {
    if (isDirty) {
      if (confirm('You have unsaved changes. Continue to run session?')) {
        navigate(`/meshes/${meshName}/run`);
      }
    } else {
      navigate(`/meshes/${meshName}/run`);
    }
  }

  // Task 8.6: Validation Summary
  function getValidationSummary(): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config) {
      return { errors, warnings };
    }

    // Check required fields
    if (!config.mesh || config.mesh.trim() === '') {
      errors.push('Mesh name is required');
    }

    if (!config.agents || config.agents.length === 0) {
      errors.push('At least one agent is required');
    } else {
      // Check for duplicate agent names
      const agentNames = config.agents.map(a => a.name);
      const duplicates = agentNames.filter((name, idx) => agentNames.indexOf(name) !== idx);
      if (duplicates.length > 0) {
        errors.push(`Duplicate agent names: ${[...new Set(duplicates)].join(', ')}`);
      }

      // Check for invalid agent names
      config.agents.forEach((agent, idx) => {
        if (!agent.name || agent.name.trim() === '') {
          errors.push(`Agent ${idx + 1}: Name is required`);
        } else if (!/^[a-z0-9-]+$/.test(agent.name)) {
          errors.push(`Agent ${idx + 1}: Name must be lowercase letters, numbers, and hyphens only`);
        }

        if (!agent.prompt || agent.prompt.trim() === '') {
          errors.push(`Agent ${idx + 1}: Prompt path is required`);
        }
      });

      // Check for multi-agent mesh without routing
      if (config.agents.length > 1 && !config.routing) {
        warnings.push('Multi-agent mesh should define routing rules');
      }
    }

    // Add YAML errors if any
    if (yamlErrors.length > 0) {
      errors.push(...yamlErrors);
    }

    return { errors, warnings };
  }

  if (loading) {
    return (
      <div className="mesh-editor">
        <div className="loading">Loading mesh configuration...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mesh-editor">
        <div className="error">
          <p>Error: {error}</p>
          <button onClick={() => navigate('/meshes')}>Back to Meshes</button>
        </div>
      </div>
    );
  }

  if (!config || !meshName) {
    return null;
  }

  const validationSummary = getValidationSummary();
  const hasErrors = validationSummary.errors.length > 0;
  const hasWarnings = validationSummary.warnings.length > 0;

  return (
    <div className="mesh-editor">
      {saving && (
        <div className="save-progress">
          <div className="save-progress-bar"></div>
        </div>
      )}

      <div className="mesh-editor-header">
        <div className="header-left">
          <button onClick={handleBack} className="back-button">
            ← Back
          </button>
          <h2>{meshName}</h2>
          {isDirty && <span className="dirty-indicator">● Unsaved</span>}
        </div>
        <div className="header-right">
          <button
            onClick={handleRunSession}
            className="run-session-button"
          >
            Run Session
          </button>
          <button
            onClick={handleReset}
            disabled={!isDirty}
            className="reset-button"
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={!isDirty || saving || hasErrors}
            className="save-button"
            title={
              hasErrors
                ? 'Fix validation errors before saving'
                : saving
                ? 'Saving...'
                : 'Save changes (Ctrl/Cmd+S)'
            }
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {config.description && (
        <p className="mesh-description">{config.description}</p>
      )}

      {(hasErrors || hasWarnings) && (
        <div className="validation-summary">
          {hasErrors && (
            <div className="validation-summary-section validation-errors-section">
              <h4>Errors ({validationSummary.errors.length})</h4>
              <ul>
                {validationSummary.errors.map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
            </div>
          )}
          {hasWarnings && (
            <div className="validation-summary-section validation-warnings-section">
              <h4>Warnings ({validationSummary.warnings.length})</h4>
              <ul>
                {validationSummary.warnings.map((warn, idx) => (
                  <li key={idx}>{warn}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="editor-container">
        <div className="editor-header">
          <div className="editor-tabs">
            <button
              className={`tab ${mode === 'yaml' ? 'tab-active' : ''}`}
              onClick={convertGUItoYAML}
              disabled={mode === 'yaml'}
            >
              YAML
            </button>
            <button
              className={`tab ${mode === 'gui' ? 'tab-active' : ''}`}
              onClick={convertYAMLtoGUI}
              disabled={mode === 'gui'}
            >
              GUI
            </button>
          </div>

          <div className="mode-info">
            {mode === 'gui' ? (
              <span className="info-badge">
                Changes sync to YAML automatically
              </span>
            ) : (
              <span className="info-badge">
                Editing raw YAML - switch to GUI for form-based editing
              </span>
            )}
          </div>
        </div>

        {mode === 'yaml' ? (
          <YAMLEditor
            value={rawYAML}
            onChange={handleYAMLChange}
            onValidationError={handleYAMLValidation}
          />
        ) : (
          <MeshForm
            config={config}
            onChange={handleConfigChange}
          />
        )}
      </div>

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}

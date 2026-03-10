/**
 * Permissions Unit Tests
 *
 * Tests resolvePermissions() function to ensure correct permission
 * resolution based on agent config and godMode.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePermissions,
  DEFAULT_ALLOWED_TOOLS,
  DEFAULT_DISALLOWED_TOOLS,
  type AgentPermissions,
} from '../../src/worker/permissions.ts';

describe('resolvePermissions - Default behavior', () => {
  it('should use dontAsk mode by default', () => {
    const result = resolvePermissions(undefined, false);
    assert.equal(result.mode, 'dontAsk');
  });

  it('should use DEFAULT_ALLOWED_TOOLS when no permissions specified', () => {
    const result = resolvePermissions(undefined, false);
    assert.deepEqual(result.allowedTools, DEFAULT_ALLOWED_TOOLS);
  });

  it('should use DEFAULT_DISALLOWED_TOOLS when no permissions specified', () => {
    const result = resolvePermissions(undefined, false);
    assert.deepEqual(result.disallowedTools, DEFAULT_DISALLOWED_TOOLS);
  });

  it('should include Bash in DEFAULT_ALLOWED_TOOLS', () => {
    assert.ok(DEFAULT_ALLOWED_TOOLS.includes('Bash'));
  });

  it('should include Task in DEFAULT_DISALLOWED_TOOLS', () => {
    assert.ok(DEFAULT_DISALLOWED_TOOLS.includes('Task'));
  });

  it('should not set allowDangerouslySkipPermissions by default', () => {
    const result = resolvePermissions(undefined, false);
    assert.equal(result.allowDangerouslySkipPermissions, undefined);
  });
});

describe('resolvePermissions - Agent permissions config', () => {
  it('should use agent mode when specified', () => {
    const permissions: AgentPermissions = {
      mode: 'acceptEdits',
    };
    const result = resolvePermissions(permissions, false);
    assert.equal(result.mode, 'acceptEdits');
  });

  it('should use agent allowedTools when specified', () => {
    const permissions: AgentPermissions = {
      allowedTools: ['Read', 'Write', 'Task'],
    };
    const result = resolvePermissions(permissions, false);
    assert.deepEqual(result.allowedTools, ['Read', 'Write', 'Task']);
  });

  it('should use agent disallowedTools when specified', () => {
    const permissions: AgentPermissions = {
      disallowedTools: ['Bash', 'WebFetch'],
    };
    const result = resolvePermissions(permissions, false);
    assert.deepEqual(result.disallowedTools, ['Bash', 'WebFetch']);
  });

  it('should use agent permissions with all fields', () => {
    const permissions: AgentPermissions = {
      mode: 'default',
      allowedTools: ['Read', 'Grep', 'Glob'],
      disallowedTools: ['Task', 'Bash'],
    };
    const result = resolvePermissions(permissions, false);
    assert.equal(result.mode, 'default');
    assert.deepEqual(result.allowedTools, ['Read', 'Grep', 'Glob']);
    assert.deepEqual(result.disallowedTools, ['Task', 'Bash']);
  });
});

describe('resolvePermissions - God mode', () => {
  it('should use bypassPermissions mode in god mode', () => {
    const result = resolvePermissions(undefined, true);
    assert.equal(result.mode, 'bypassPermissions');
  });

  it('should set allowDangerouslySkipPermissions in god mode', () => {
    const result = resolvePermissions(undefined, true);
    assert.equal(result.allowDangerouslySkipPermissions, true);
  });

  it('should use empty allowedTools in god mode', () => {
    const result = resolvePermissions(undefined, true);
    assert.deepEqual(result.allowedTools, []);
  });

  it('should not set disallowedTools in god mode', () => {
    const result = resolvePermissions(undefined, true);
    assert.equal(result.disallowedTools, undefined);
  });

  it('should override agent permissions in god mode', () => {
    const permissions: AgentPermissions = {
      mode: 'dontAsk',
      allowedTools: ['Read', 'Write'],
      disallowedTools: ['Task'],
    };
    const result = resolvePermissions(permissions, true);
    assert.equal(result.mode, 'bypassPermissions');
    assert.deepEqual(result.allowedTools, []);
    assert.equal(result.allowDangerouslySkipPermissions, true);
  });
});

describe('resolvePermissions - DEFAULT_ALLOWED_TOOLS content', () => {
  it('should include Read in defaults', () => {
    assert.ok(DEFAULT_ALLOWED_TOOLS.includes('Read'));
  });

  it('should include Write in defaults', () => {
    assert.ok(DEFAULT_ALLOWED_TOOLS.includes('Write'));
  });

  it('should include Edit in defaults', () => {
    assert.ok(DEFAULT_ALLOWED_TOOLS.includes('Edit'));
  });

  it('should include Glob in defaults', () => {
    assert.ok(DEFAULT_ALLOWED_TOOLS.includes('Glob'));
  });

  it('should include Grep in defaults', () => {
    assert.ok(DEFAULT_ALLOWED_TOOLS.includes('Grep'));
  });

  it('should include Bash in defaults', () => {
    assert.ok(DEFAULT_ALLOWED_TOOLS.includes('Bash'));
  });
});

describe('resolvePermissions - DEFAULT_DISALLOWED_TOOLS content', () => {
  it('should include Task in disallowed defaults', () => {
    assert.ok(DEFAULT_DISALLOWED_TOOLS.includes('Task'));
  });

  it('should only contain Task by default', () => {
    assert.equal(DEFAULT_DISALLOWED_TOOLS.length, 1);
    assert.deepEqual(DEFAULT_DISALLOWED_TOOLS, ['Task']);
  });
});

describe('resolvePermissions - Permission mode types', () => {
  it('should accept dontAsk mode', () => {
    const permissions: AgentPermissions = { mode: 'dontAsk' };
    const result = resolvePermissions(permissions, false);
    assert.equal(result.mode, 'dontAsk');
  });

  it('should accept acceptEdits mode', () => {
    const permissions: AgentPermissions = { mode: 'acceptEdits' };
    const result = resolvePermissions(permissions, false);
    assert.equal(result.mode, 'acceptEdits');
  });

  it('should accept default mode', () => {
    const permissions: AgentPermissions = { mode: 'default' };
    const result = resolvePermissions(permissions, false);
    assert.equal(result.mode, 'default');
  });

  it('should accept bypassPermissions mode', () => {
    const permissions: AgentPermissions = { mode: 'bypassPermissions' };
    const result = resolvePermissions(permissions, false);
    assert.equal(result.mode, 'bypassPermissions');
  });
});

describe('resolvePermissions - Edge cases', () => {
  it('should handle empty allowedTools array', () => {
    const permissions: AgentPermissions = {
      allowedTools: [],
    };
    const result = resolvePermissions(permissions, false);
    assert.deepEqual(result.allowedTools, []);
  });

  it('should handle empty disallowedTools array', () => {
    const permissions: AgentPermissions = {
      disallowedTools: [],
    };
    const result = resolvePermissions(permissions, false);
    assert.deepEqual(result.disallowedTools, []);
  });

  it('should handle partial permissions config (mode only)', () => {
    const permissions: AgentPermissions = {
      mode: 'acceptEdits',
    };
    const result = resolvePermissions(permissions, false);
    assert.equal(result.mode, 'acceptEdits');
    assert.deepEqual(result.allowedTools, DEFAULT_ALLOWED_TOOLS);
    assert.deepEqual(result.disallowedTools, DEFAULT_DISALLOWED_TOOLS);
  });

  it('should handle partial permissions config (tools only)', () => {
    const permissions: AgentPermissions = {
      allowedTools: ['Read', 'Write'],
    };
    const result = resolvePermissions(permissions, false);
    assert.equal(result.mode, 'dontAsk'); // default mode
    assert.deepEqual(result.allowedTools, ['Read', 'Write']);
    assert.deepEqual(result.disallowedTools, DEFAULT_DISALLOWED_TOOLS);
  });
});

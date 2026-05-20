import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ClaudeCliAdapter,
  isClaudePaneIdle,
  parseClaudeTranscript,
  workDirSlug,
  claudeProjectDir,
} from '../claude-adapter.ts';

let tmpHome: string;
let tmpWork: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-claude-home-'));
  tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-claude-work-'));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpWork, { recursive: true, force: true });
});

describe('workDirSlug', () => {
  it('replaces non-alphanumeric chars with dashes', () => {
    assert.equal(workDirSlug('/home/user/tx'), '-home-user-tx');
    assert.equal(workDirSlug('/Users/foo/My Project'), '-Users-foo-My-Project');
    assert.equal(workDirSlug('/a.b/c-d'), '-a-b-c-d');
  });

  it('resolves to absolute before slugifying', () => {
    const abs = path.resolve('.');
    assert.equal(workDirSlug('.'), workDirSlug(abs));
  });

  it('preserves underscores (treated as identifier-safe)', () => {
    assert.equal(workDirSlug('/foo/my_dir'), '-foo-my_dir');
  });
});

describe('claudeProjectDir', () => {
  it('builds ~/.claude/projects/<slug>', () => {
    const dir = claudeProjectDir('/home/user/tx', '/fake/home');
    assert.equal(dir, '/fake/home/.claude/projects/-home-user-tx');
  });
});

describe('isClaudePaneIdle', () => {
  it('returns idle for empty / trivial panes', () => {
    assert.equal(isClaudePaneIdle(''), true);
    assert.equal(isClaudePaneIdle('hello\nworld'), true);
  });

  it('returns busy when "esc to interrupt" is visible', () => {
    assert.equal(isClaudePaneIdle('Doing work...\nesc to interrupt'), false);
    assert.equal(isClaudePaneIdle('Working\nesc to cancel'), false);
  });

  it('returns busy when spinner glyphs are visible', () => {
    assert.equal(isClaudePaneIdle('Loading ⠋'), false);
    assert.equal(isClaudePaneIdle('⠙ thinking'), false);
  });

  it('returns busy when tool execution status lines are visible', () => {
    assert.equal(isClaudePaneIdle('Running command: ls'), false);
    assert.equal(isClaudePaneIdle('Reading /etc/hostname'), false);
    assert.equal(isClaudePaneIdle('Writing file.txt'), false);
  });

  it('drops border characters and status bar lines when classifying', () => {
    const noisy = `
─────────────
[##] 5 msgs
plain output line
─────────────
`;
    assert.equal(isClaudePaneIdle(noisy), true);
  });
});

describe('parseClaudeTranscript', () => {
  it('parses a simple user→assistant text exchange', () => {
    const jsonl = [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } }),
    ].join('\n');
    const msgs = parseClaudeTranscript(jsonl);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].role, 'user');
    assert.equal((msgs[0].content[0] as { text: string }).text, 'hi');
    assert.equal(msgs[1].role, 'assistant');
  });

  it('passes string-content messages through as a single text block', () => {
    const jsonl = JSON.stringify({ type: 'user', message: { role: 'user', content: 'plain string' } });
    const msgs = parseClaudeTranscript(jsonl);
    assert.equal(msgs.length, 1);
    assert.equal((msgs[0].content[0] as { type: string; text: string }).text, 'plain string');
  });

  it('maps tool_use and tool_result blocks', () => {
    const jsonl = [
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
        { type: 'text', text: 'Reading' },
        { type: 'tool_use', id: 'tu1', name: 'Read', input: { file: '/x' } },
      ]}}),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 'tu1', content: 'hello', is_error: false },
      ]}}),
    ].join('\n');
    const msgs = parseClaudeTranscript(jsonl);
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].content[1].type, 'tool_use');
    const tr = msgs[1].content[0] as { type: string; tool_use_id: string; content: string };
    assert.equal(tr.type, 'tool_result');
    assert.equal(tr.tool_use_id, 'tu1');
    assert.equal(tr.content, 'hello');
  });

  it('skips system/summary types and malformed lines', () => {
    const jsonl = [
      JSON.stringify({ type: 'system', content: 'init' }),
      '{not json',
      '',
      JSON.stringify({ type: 'summary', message: { content: 'compact' } }),
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'keep me' }] } }),
    ].join('\n');
    const msgs = parseClaudeTranscript(jsonl);
    assert.equal(msgs.length, 1);
    assert.equal((msgs[0].content[0] as { text: string }).text, 'keep me');
  });

  it('drops unknown content block types silently', () => {
    const jsonl = JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [
      { type: 'text', text: 'visible' },
      { type: 'image', source: { type: 'base64', data: 'xxx' } },  // not modeled
    ]}});
    const msgs = parseClaudeTranscript(jsonl);
    assert.equal(msgs[0].content.length, 1);
    assert.equal((msgs[0].content[0] as { type: string }).type, 'text');
  });
});

describe('ClaudeCliAdapter — buildArgs / buildResumeArgs / envOverrides', () => {
  it('buildArgs returns binary plus optional model', () => {
    const a = new ClaudeCliAdapter({ binaryOverride: '/usr/local/bin/claude' });
    assert.deepEqual(a.buildArgs({ task: 't', workDir: tmpWork, txDataDir: tmpWork }), ['/usr/local/bin/claude']);
    assert.deepEqual(
      a.buildArgs({ task: 't', workDir: tmpWork, txDataDir: tmpWork, model: 'sonnet' }),
      ['/usr/local/bin/claude', '--model', 'sonnet'],
    );
  });

  it('buildResumeArgs includes --resume <sessionId>', () => {
    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude' });
    const argv = a.buildResumeArgs({ task: '', sessionId: 'sess-1', workDir: tmpWork, txDataDir: tmpWork });
    assert.deepEqual(argv, ['/bin/claude', '--resume', 'sess-1']);
  });

  it('envOverrides only includes ANTHROPIC_API_KEY when present in env', () => {
    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude' });
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      assert.deepEqual(a.envOverrides({ task: '', workDir: tmpWork, txDataDir: tmpWork }), {});
      process.env.ANTHROPIC_API_KEY = 'k';
      assert.deepEqual(a.envOverrides({ task: '', workDir: tmpWork, txDataDir: tmpWork }), { ANTHROPIC_API_KEY: 'k' });
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });

  it('discover returns null when binary not found and no override', async () => {
    const a = new ClaudeCliAdapter({ binaryOverride: null });
    const d = await a.discover();
    assert.equal(d, null);
  });
});

describe('ClaudeCliAdapter — transcriptPath / extractSessionId', () => {
  it('transcriptPath joins home + slug + sessionId', () => {
    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude', homedirOverride: '/h' });
    const p = a.transcriptPath('/home/user/tx', 'abc');
    assert.equal(p, '/h/.claude/projects/-home-user-tx/abc.jsonl');
  });

  it('transcriptPath returns null without sessionId', () => {
    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude', homedirOverride: '/h' });
    assert.equal(a.transcriptPath('/anywhere', undefined), null);
  });

  it('extractSessionId pulls UUID-shaped filename stem', async () => {
    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude' });
    assert.equal(
      await a.extractSessionId('/x/.claude/projects/-foo/abc12345.jsonl'),
      'abc12345',
    );
    assert.equal(
      await a.extractSessionId('/x/.claude/projects/-foo/12345678-1234-1234-1234-123456789abc.jsonl'),
      '12345678-1234-1234-1234-123456789abc',
    );
  });

  it('extractSessionId returns null for non-matching files', async () => {
    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude' });
    assert.equal(await a.extractSessionId('/foo/not-a-session.txt'), null);
  });
});

describe('ClaudeCliAdapter — readTranscript', () => {
  it('returns parsed messages for a complete file', async () => {
    const file = path.join(tmpWork, 't.jsonl');
    fs.writeFileSync(file, [
      JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] } }),
    ].join('\n') + '\n');

    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude' });
    const r = await a.readTranscript(file);
    assert.equal(r.messages.length, 2);
    assert.equal(r.cursor.byteOffset, fs.statSync(file).size);
  });

  it('returns empty when file does not exist (yet)', async () => {
    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude' });
    const r = await a.readTranscript(path.join(tmpWork, 'nope.jsonl'));
    assert.equal(r.messages.length, 0);
    assert.equal(r.cursor.byteOffset, 0);
  });

  it('does incremental reads (cursor advances by complete lines)', async () => {
    const file = path.join(tmpWork, 't.jsonl');
    fs.writeFileSync(file, JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'a' }] } }) + '\n');

    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude' });
    const first = await a.readTranscript(file);
    assert.equal(first.messages.length, 1);

    // Append a second line
    fs.appendFileSync(file, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'b' }] } }) + '\n');
    const second = await a.readTranscript(file, first.cursor);
    assert.equal(second.messages.length, 1);
    assert.equal(second.messages[0].role, 'assistant');
  });

  it('does not advance cursor past a partial trailing line', async () => {
    const file = path.join(tmpWork, 't.jsonl');
    // Write a complete line + a partial (unterminated) line
    fs.writeFileSync(file, JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'x' }] } }) + '\n{partial');

    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude' });
    const r = await a.readTranscript(file);
    assert.equal(r.messages.length, 1);
    // Cursor stops at the end of the complete line, not the file end
    assert.ok(r.cursor.byteOffset < fs.statSync(file).size);
  });
});

describe('ClaudeCliAdapter — installHooks', () => {
  it('writes hooks to .claude/settings.local.json with correct shape', async () => {
    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude' });
    await a.installHooks(tmpWork, [
      { event: 'PreToolUse', toolMatch: 'Bash', script: '/x/bash-guard' },
      { event: 'PostToolUse', toolMatch: 'Edit', script: '/x/write-gate' },
    ]);
    const settings = JSON.parse(fs.readFileSync(path.join(tmpWork, '.claude', 'settings.local.json'), 'utf8'));
    assert.ok(Array.isArray(settings.hooks.PreToolUse));
    assert.equal(settings.hooks.PreToolUse[0].matcher, 'Bash');
    assert.equal(settings.hooks.PreToolUse[0].hooks[0].type, 'command');
    assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, '/x/bash-guard');
    assert.equal(settings.hooks.PostToolUse[0].matcher, 'Edit');
  });

  it('preserves existing hooks in the settings file', async () => {
    const dir = path.join(tmpWork, '.claude');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'settings.local.json'), JSON.stringify({
      otherKey: 'preserve',
      hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: '/existing' }] }] },
    }));

    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude' });
    await a.installHooks(tmpWork, [{ event: 'PreToolUse', toolMatch: 'Bash', script: '/new' }]);

    const after = JSON.parse(fs.readFileSync(path.join(dir, 'settings.local.json'), 'utf8'));
    assert.equal(after.otherKey, 'preserve');
    assert.equal(after.hooks.PreToolUse.length, 2);
    assert.equal(after.hooks.PreToolUse[0].hooks[0].command, '/existing');
    assert.equal(after.hooks.PreToolUse[1].hooks[0].command, '/new');
  });
});

describe('ClaudeCliAdapter — interruptKey', () => {
  it('returns the default C-c', () => {
    const a = new ClaudeCliAdapter({ binaryOverride: '/bin/claude' });
    assert.equal(a.interruptKey(), 'C-c');
  });
});

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createGenericCliAdapter,
  CODEX_REFERENCE_CONFIG,
  OPENCODE_REFERENCE_CONFIG,
  PI_MONO_REFERENCE_CONFIG,
} from '../generic-adapter.ts';
import type { ProviderMessage } from '../../llm/provider.ts';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tx-gen-adapter-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('createGenericCliAdapter — defaults', () => {
  it('produces an adapter with conservative capabilities by default', () => {
    const a = createGenericCliAdapter({ name: 'x', binary: '/bin/x' });
    assert.equal(a.name, 'x');
    assert.equal(a.capabilities.sessionResume, false);
    assert.equal(a.capabilities.structuredTranscript, false);
    assert.equal(a.capabilities.hookSupport, 'none');
    assert.equal(a.capabilities.trustTier, 'sandbox-only');
  });

  it('buildArgs defaults to [binary] plus model when present', () => {
    const a = createGenericCliAdapter({ name: 'x', binary: '/bin/x' });
    assert.deepEqual(a.buildArgs({ task: 't', workDir: tmpDir, txDataDir: tmpDir }), ['/bin/x']);
    assert.deepEqual(
      a.buildArgs({ task: 't', workDir: tmpDir, txDataDir: tmpDir, model: 'm1' }),
      ['/bin/x', '--model', 'm1'],
    );
  });

  it('buildResumeArgs throws when no resumeArgv supplied', () => {
    const a = createGenericCliAdapter({ name: 'x', binary: '/bin/x' });
    assert.throws(
      () => a.buildResumeArgs({ task: '', sessionId: 's', workDir: tmpDir, txDataDir: tmpDir }),
      /resume not supported/,
    );
  });

  it('transcriptPath returns null when no transcriptDir configured', () => {
    const a = createGenericCliAdapter({ name: 'x', binary: '/bin/x' });
    assert.equal(a.transcriptPath(tmpDir, 's'), null);
  });

  it('readTranscript returns empty when no parser configured', async () => {
    const a = createGenericCliAdapter({ name: 'x', binary: '/bin/x' });
    const r = await a.readTranscript('/anywhere');
    assert.deepEqual(r.messages, []);
  });

  it('isIdle returns true when no idleHints supplied (assume idle)', () => {
    const a = createGenericCliAdapter({ name: 'x', binary: '/bin/x' });
    assert.equal(a.isIdle('anything at all'), true);
  });

  it('isIdle returns false when any hint matches', () => {
    const a = createGenericCliAdapter({
      name: 'x', binary: '/bin/x',
      idleHints: [/thinking/i, /running/i],
    });
    assert.equal(a.isIdle('Currently thinking...'), false);
    assert.equal(a.isIdle('Now running command'), false);
    assert.equal(a.isIdle('Awaiting input'), true);
  });
});

describe('createGenericCliAdapter — overrides', () => {
  it('custom argv builder is invoked', () => {
    const a = createGenericCliAdapter({
      name: 'x', binary: '/bin/x',
      argv: (opts) => ['/bin/x', '--task', opts.task, '--cwd', opts.workDir],
    });
    assert.deepEqual(
      a.buildArgs({ task: 'do', workDir: '/w', txDataDir: '/d' }),
      ['/bin/x', '--task', 'do', '--cwd', '/w'],
    );
  });

  it('resumeArgv enables session resume', () => {
    const a = createGenericCliAdapter({
      name: 'x', binary: '/bin/x',
      resumeArgv: (opts) => ['/bin/x', '--resume', opts.sessionId],
    });
    assert.equal(a.capabilities.sessionResume, true);
    assert.deepEqual(
      a.buildResumeArgs({ task: '', sessionId: 'sess', workDir: tmpDir, txDataDir: tmpDir }),
      ['/bin/x', '--resume', 'sess'],
    );
  });

  it('env override is propagated', () => {
    const a = createGenericCliAdapter({
      name: 'x', binary: '/bin/x',
      env: (opts) => ({ OPENROUTER_API_KEY: 'k', WD: opts.workDir }),
    });
    const env = a.envOverrides({ task: 't', workDir: '/w', txDataDir: '/d' });
    assert.equal(env.OPENROUTER_API_KEY, 'k');
    assert.equal(env.WD, '/w');
  });

  it('custom interruptKey is honored', () => {
    const a = createGenericCliAdapter({ name: 'x', binary: '/bin/x', interruptKey: 'Escape' });
    assert.equal(a.interruptKey?.(), 'Escape');
  });
});

describe('createGenericCliAdapter — transcript wiring', () => {
  const parser = (chunk: string): ProviderMessage[] =>
    chunk.split('\n').filter(Boolean).map(line => ({
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: line }],
    }));

  it('transcriptPath joins dir + sessionId + ext', () => {
    const a = createGenericCliAdapter({
      name: 'x', binary: '/bin/x',
      transcriptDir: (w) => path.join(w, '.tool', 'transcripts'),
      transcriptParser: parser,
    });
    assert.equal(a.transcriptPath('/w', 'sess'), '/w/.tool/transcripts/sess.jsonl');
    assert.equal(a.transcriptPath('/w', undefined), null);
  });

  it('custom transcript extension is used', () => {
    const a = createGenericCliAdapter({
      name: 'x', binary: '/bin/x',
      transcriptDir: (w) => w,
      transcriptExt: '.log',
      transcriptParser: parser,
    });
    assert.equal(a.transcriptPath('/w', 'sess'), '/w/sess.log');
  });

  it('readTranscript invokes parser on incremental chunks', async () => {
    const a = createGenericCliAdapter({
      name: 'x', binary: '/bin/x',
      transcriptDir: (w) => w,
      transcriptParser: parser,
    });
    const file = path.join(tmpDir, 't.jsonl');
    fs.writeFileSync(file, 'one\ntwo\n');
    const r1 = await a.readTranscript(file);
    assert.equal(r1.messages.length, 2);
    fs.appendFileSync(file, 'three\n');
    const r2 = await a.readTranscript(file, r1.cursor);
    assert.equal(r2.messages.length, 1);
    assert.equal((r2.messages[0].content[0] as { text: string }).text, 'three');
  });

  it('extractSessionId strips the configured extension', async () => {
    const a = createGenericCliAdapter({
      name: 'x', binary: '/bin/x',
      transcriptDir: (w) => w,
      transcriptExt: '.log',
      transcriptParser: parser,
    });
    assert.equal(await a.extractSessionId('/w/abc123.log'), 'abc123');
    assert.equal(await a.extractSessionId('/w/no-ext'), null);
  });

  it('sessionIdFromPath override takes precedence', async () => {
    const a = createGenericCliAdapter({
      name: 'x', binary: '/bin/x',
      transcriptDir: (w) => w,
      transcriptParser: parser,
      sessionIdFromPath: () => 'always-this',
    });
    assert.equal(await a.extractSessionId('/anywhere/x.jsonl'), 'always-this');
  });
});

describe('createGenericCliAdapter — capability consistency guards', () => {
  it('throws when sessionResume:true is claimed without resumeArgv', () => {
    assert.throws(
      () => createGenericCliAdapter({
        name: 'x', binary: '/bin/x',
        capabilities: { sessionResume: true },
      }),
      /sessionResume=true but no resumeArgv/,
    );
  });

  it('throws when structuredTranscript:true is claimed without parser', () => {
    assert.throws(
      () => createGenericCliAdapter({
        name: 'x', binary: '/bin/x',
        transcriptDir: (w) => w,
        capabilities: { structuredTranscript: true },
      }),
      /structuredTranscript=true but no transcriptParser/,
    );
  });
});

describe('reference configurations', () => {
  it('CODEX_REFERENCE_CONFIG builds a sensible adapter', () => {
    const a = createGenericCliAdapter(CODEX_REFERENCE_CONFIG);
    assert.equal(a.name, 'codex');
    assert.equal(a.capabilities.sessionResume, false);  // opt-in once verified
    assert.equal(a.capabilities.hookSupport, 'none');
    assert.equal(a.isIdle('thinking...'), false);
    assert.equal(a.isIdle('Awaiting input'), true);
  });

  it('OPENCODE_REFERENCE_CONFIG builds a sensible adapter', () => {
    const a = createGenericCliAdapter(OPENCODE_REFERENCE_CONFIG);
    assert.equal(a.name, 'opencode');
    assert.equal(a.capabilities.trustTier, 'sandbox-only');
  });

  it('PI_MONO_REFERENCE_CONFIG builds a minimal adapter', () => {
    const a = createGenericCliAdapter(PI_MONO_REFERENCE_CONFIG);
    assert.equal(a.name, 'pi-mono');
    assert.equal(a.capabilities.sessionResume, false);  // opt-in once verified
    assert.equal(a.capabilities.trustTier, 'sandbox-only');
  });
});

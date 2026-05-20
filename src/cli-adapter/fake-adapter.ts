/**
 * FakeCliAdapter — scriptable in-memory CliAdapter for tests.
 *
 * Configure the binary discovery result, the transcript content, idle/done
 * predicates, and observe what argv + env the runner builds. Used by the
 * upcoming TmuxCliRunner tests and the registry tests.
 */

import type {
  CliAdapter,
  CliAdapterCapabilities,
  CliResumeOptions,
  CliTaskOptions,
  DetectedPermissionPrompt,
  DiscoveryResult,
  HookSpec,
  TranscriptCursor,
  TranscriptRead,
} from './adapter.ts';
import type { ProviderMessage } from '../llm/provider.ts';

export interface FakeCliAdapterOptions {
  name?: string;
  capabilities?: Partial<CliAdapterCapabilities>;
  discovery?: DiscoveryResult | null;
  transcript?: ProviderMessage[];
  /** Override the done flag returned on `readTranscript`. Default false. */
  done?: boolean;
  /** Override `isIdle` predicate (defaults to `pane.endsWith('$ ')`). */
  isIdle?: (pane: string) => boolean;
  /** Override `extractSessionId` (defaults to filename stem). */
  sessionIdFromPath?: (path: string) => string | null;
  /** Override `detectPermissionPrompt`. */
  permissionDetector?: (pane: string) => DetectedPermissionPrompt | null;
  /** If set, installHooks records into this array for assertions. */
  hookSink?: HookSpec[];
}

export class FakeCliAdapter implements CliAdapter {
  readonly name: string;
  readonly capabilities: CliAdapterCapabilities;
  readonly buildArgsCalls: CliTaskOptions[] = [];
  readonly buildResumeCalls: CliResumeOptions[] = [];
  readonly envOverrideCalls: CliTaskOptions[] = [];

  private readonly opts: Required<Omit<FakeCliAdapterOptions, 'capabilities' | 'discovery' | 'transcript' | 'permissionDetector' | 'hookSink'>>
    & Pick<FakeCliAdapterOptions, 'permissionDetector' | 'hookSink'>;
  private readonly discoveryResult: DiscoveryResult | null;
  private readonly transcript: ProviderMessage[];

  constructor(opts: FakeCliAdapterOptions = {}) {
    this.name = opts.name ?? 'fake';
    this.capabilities = {
      sessionResume: true,
      structuredTranscript: true,
      hookSupport: 'shell-scripts',
      trustTier: 'full-hooks',
      ...opts.capabilities,
    };
    this.discoveryResult = opts.discovery === undefined
      ? { binary: '/usr/local/bin/fake', version: '0.0.0-test' }
      : opts.discovery;
    this.transcript = opts.transcript ?? [];
    this.opts = {
      name: this.name,
      done: opts.done ?? false,
      isIdle: opts.isIdle ?? ((p: string) => p.endsWith('$ ')),
      sessionIdFromPath: opts.sessionIdFromPath ?? ((p: string) => {
        const m = p.match(/([^/]+)\.jsonl?$/);
        return m ? m[1] : null;
      }),
      permissionDetector: opts.permissionDetector,
      hookSink: opts.hookSink,
    };
  }

  async discover(): Promise<DiscoveryResult | null> {
    return this.discoveryResult;
  }

  buildArgs(opts: CliTaskOptions): string[] {
    this.buildArgsCalls.push(opts);
    return [
      this.discoveryResult?.binary ?? this.name,
      '--task', opts.task,
      '--cwd', opts.workDir,
      ...(opts.model ? ['--model', opts.model] : []),
    ];
  }

  buildResumeArgs(opts: CliResumeOptions): string[] {
    if (!this.capabilities.sessionResume) {
      throw new Error(`${this.name}: resume not supported`);
    }
    this.buildResumeCalls.push(opts);
    return [
      this.discoveryResult?.binary ?? this.name,
      '--resume', opts.sessionId,
      '--cwd', opts.workDir,
      ...(opts.followUp ? ['--followup', opts.followUp] : []),
    ];
  }

  envOverrides(opts: CliTaskOptions): Record<string, string> {
    this.envOverrideCalls.push(opts);
    return { FAKE_TX_RUN: '1', FAKE_WORKDIR: opts.workDir };
  }

  transcriptPath(workDir: string, sessionId?: string): string | null {
    return sessionId ? `${workDir}/.fake/${sessionId}.jsonl` : null;
  }

  async readTranscript(_path: string, cursor?: TranscriptCursor): Promise<TranscriptRead> {
    // Stateless: return entire scripted transcript regardless of cursor;
    // tests can configure incremental reads by constructing multiple adapters.
    return {
      messages: this.transcript,
      cursor: cursor ?? { byteOffset: 0 },
      done: this.opts.done,
    };
  }

  async extractSessionId(transcriptPath: string): Promise<string | null> {
    return this.opts.sessionIdFromPath(transcriptPath);
  }

  isIdle(pane: string): boolean {
    return this.opts.isIdle(pane);
  }

  detectPermissionPrompt(pane: string): DetectedPermissionPrompt | null {
    return this.opts.permissionDetector ? this.opts.permissionDetector(pane) : null;
  }

  async installHooks(_workDir: string, hooks: HookSpec[]): Promise<void> {
    if (this.capabilities.hookSupport === 'none') {
      throw new Error(`${this.name}: hookSupport=none — refuse to install`);
    }
    if (this.opts.hookSink) {
      this.opts.hookSink.push(...hooks);
    }
  }
}

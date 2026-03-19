/**
 * ExploreOrchestrator - Parallel fork-and-judge exploration with recursive synthesis
 *
 * Implements summary-based branching (NOT SDK session forking):
 * 1. Load checkpoint conversation
 * 2. Summarize conversation history
 * 3. Create N parallel branches, each with: summary + different fragment as additional context
 * 4. Each branch runs as NEW conversation via SDK query()
 * 5. Judge synthesizes branch outputs
 * 6. If confidence < threshold: register synthesis as new fragment, recurse (max 3 rounds)
 * 7. Log exploration dataset (JSONL, append-only)
 *
 * CRITICAL: This does NOT fork SDK sessions. It reconstructs context via summarization.
 */

import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { log } from '../shared/logger.ts';
import { SessionStore } from '../session/session-store.ts';
import { FragmentRegistry } from './fragment-registry.ts';
import { AgentCheckpointStore } from './stores/checkpoint-store.ts';
import { runHaikuQuery } from '../session/session-summarizer.ts';
import type {
  ExplorationRecord,
  ExplorationBranch,
  ExplorationResult,
  ExplorationOutcome,
} from './types.ts';

const COMPONENT = 'explore-orchestrator';

export interface ExploreOptions {
  checkpointId: string;
  fragmentNames: string[];
  judgeAgentName?: string;
  budgetPerBranch?: number;
  maxRounds?: number;
  confidenceThreshold?: number;
}

export interface JudgeVerdict {
  confidence: number;
  synthesis: string;
}

export class ExploreOrchestrator {
  private checkpointStore: AgentCheckpointStore;
  private sessionStore: SessionStore;
  private fragmentRegistry: FragmentRegistry;
  private explorationDir: string;
  private maxRounds: number;
  private confidenceThreshold: number;

  constructor(
    checkpointStore: AgentCheckpointStore,
    sessionStore: SessionStore,
    fragmentRegistry: FragmentRegistry,
    explorationDir: string,
    maxRounds: number = 3,
    confidenceThreshold: number = 0.8
  ) {
    this.checkpointStore = checkpointStore;
    this.sessionStore = sessionStore;
    this.fragmentRegistry = fragmentRegistry;
    this.explorationDir = explorationDir;
    this.maxRounds = maxRounds;
    this.confidenceThreshold = confidenceThreshold;
  }

  /**
   * Run parallel exploration with recursive synthesis
   */
  async explore(options: ExploreOptions): Promise<ExplorationResult> {
    const explorationId = `explore-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const rounds: ExplorationRecord[] = [];

    log.info(COMPONENT, 'Starting exploration', {
      explorationId,
      checkpointId: options.checkpointId,
      fragments: options.fragmentNames,
    });

    // Load checkpoint
    const checkpoint = this.checkpointStore.get(options.checkpointId);
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${options.checkpointId}`);
    }

    if (!checkpoint.conversation_id) {
      throw new Error(`Checkpoint has no conversation_id: ${options.checkpointId}`);
    }

    // Get conversation summary (from checkpoint or generate)
    let conversationSummary = checkpoint.summary;
    if (!conversationSummary) {
      // Load session and summarize
      // conversation_id from SDK is equivalent to our session_id
      const session = this.sessionStore.getSession(checkpoint.conversation_id);
      if (!session) {
        throw new Error(`Session not found for conversation_id: ${checkpoint.conversation_id}`);
      }

      conversationSummary = await this.summarizeConversation(session.transcriptPath);
      log.info(COMPONENT, 'Generated conversation summary', {
        explorationId,
        summaryLength: conversationSummary.length,
      });
    }

    // Exploration loop (max maxRounds)
    let currentFragments = options.fragmentNames;
    let roundNumber = 0;
    let finalConfidence = 0;
    let finalSynthesis = '';

    while (roundNumber < this.maxRounds) {
      roundNumber++;

      log.info(COMPONENT, `Starting exploration round ${roundNumber}`, {
        explorationId,
        fragments: currentFragments,
      });

      // Branch: Create N parallel conversations
      const branches = await this.runBranches(
        conversationSummary,
        currentFragments,
        options.budgetPerBranch
      );

      // Judge: Synthesize branch outputs
      const verdict = await this.judgeOutcomes(branches, options.judgeAgentName);

      // Record round
      const record: ExplorationRecord = {
        exploration_id: explorationId,
        mesh_instance: checkpoint.mesh_instance,
        agent_id: checkpoint.agent_id,
        checkpoint_id: checkpoint.id,
        round: roundNumber,
        branches,
        synthesis: verdict.synthesis,
        confidence: verdict.confidence,
        outcome: null, // Set at end
        created_at: new Date().toISOString(),
      };

      rounds.push(record);
      finalConfidence = verdict.confidence;
      finalSynthesis = verdict.synthesis;

      log.info(COMPONENT, `Round ${roundNumber} complete`, {
        explorationId,
        confidence: verdict.confidence,
        threshold: this.confidenceThreshold,
      });

      // Check convergence
      if (verdict.confidence >= this.confidenceThreshold) {
        // Converged!
        record.outcome = 'converged';
        this.writeExplorationDataset(explorationId, rounds);

        log.info(COMPONENT, 'Exploration converged', {
          explorationId,
          rounds: roundNumber,
          finalConfidence: verdict.confidence,
        });

        return {
          final_text: verdict.synthesis,
          confidence: verdict.confidence,
          rounds: roundNumber,
          exploration_id: explorationId,
        };
      }

      // Not converged - check if we can continue
      if (roundNumber >= this.maxRounds) {
        // Max rounds reached
        record.outcome = 'max_rounds_exceeded';
        this.writeExplorationDataset(explorationId, rounds);

        log.warn(COMPONENT, 'Exploration max rounds exceeded', {
          explorationId,
          rounds: roundNumber,
          finalConfidence: verdict.confidence,
        });

        return {
          final_text: verdict.synthesis,
          confidence: verdict.confidence,
          rounds: roundNumber,
          exploration_id: explorationId,
        };
      }

      // Register synthesis as new fragment for next round
      const synthesisFragmentName = `synthesis-round-${roundNumber}`;
      this.fragmentRegistry.register(synthesisFragmentName, verdict.synthesis, 'Synthesis from judge');

      log.info(COMPONENT, `Registered synthesis fragment for next round`, {
        explorationId,
        fragmentName: synthesisFragmentName,
      });

      // Add synthesis fragment to current fragments for next round
      currentFragments = [...currentFragments, synthesisFragmentName];
    }

    // Should never reach here, but handle it
    const lastRecord = rounds[rounds.length - 1];
    if (lastRecord) {
      lastRecord.outcome = 'max_rounds_exceeded';
    }
    this.writeExplorationDataset(explorationId, rounds);

    return {
      final_text: finalSynthesis,
      confidence: finalConfidence,
      rounds: roundNumber,
      exploration_id: explorationId,
    };
  }

  /**
   * Run N parallel branches with different fragments
   */
  private async runBranches(
    conversationSummary: string,
    fragmentNames: string[],
    budgetPerBranch?: number
  ): Promise<ExplorationBranch[]> {
    const branchPromises = fragmentNames.map(async (fragmentName) => {
      const fragment = this.fragmentRegistry.resolve(fragmentName);
      if (!fragment) {
        log.error(COMPONENT, 'Fragment not found during branch execution', { fragmentName });
        return {
          fragment_name: fragmentName,
          conversation_id: '',
          outcome: 'failed' as const,
          tokens_used: 0,
        };
      }

      try {
        // Build prompt: summary + fragment
        const prompt = `# Context from Previous Conversation

${conversationSummary}

# Additional Guidance

${fragment.content}

# Task

Continue from where the conversation left off, using the guidance above to inform your approach.
`;

        let conversationId = '';
        let outputText = '';
        let tokensUsed = 0;

        // Run query with budget constraint
        const queryOptions: any = {
          model: 'sonnet',
          maxTurns: budgetPerBranch || 10,
          permissionMode: 'dontAsk',
        };

        for await (const message of query({ prompt, options: queryOptions })) {
          // Capture conversation ID
          if (message.type === 'conversationId') {
            conversationId = message.conversationId;
          }

          // Capture text output
          if (message.type === 'assistant' && message.message?.content) {
            for (const block of message.message.content) {
              if (block.type === 'text') {
                outputText += block.text;
              }
            }
          }

          // Capture token usage
          if (message.type === 'usage') {
            tokensUsed = message.usage.inputTokens + message.usage.outputTokens;
          }
        }

        log.info(COMPONENT, 'Branch completed', {
          fragmentName,
          conversationId,
          tokensUsed,
          outputLength: outputText.length,
        });

        return {
          fragment_name: fragmentName,
          conversation_id: conversationId,
          outcome: 'success' as const,
          tokens_used: tokensUsed,
        };
      } catch (err) {
        log.error(COMPONENT, 'Branch failed', {
          fragmentName,
          error: err instanceof Error ? err.message : String(err),
        });

        return {
          fragment_name: fragmentName,
          conversation_id: '',
          outcome: 'failed' as const,
          tokens_used: 0,
        };
      }
    });

    return Promise.all(branchPromises);
  }

  /**
   * Judge branch outcomes and synthesize verdict
   */
  private async judgeOutcomes(
    branches: ExplorationBranch[],
    judgeAgentName?: string
  ): Promise<JudgeVerdict> {
    // Collect branch outcomes
    const successfulBranches = branches.filter((b) => b.outcome === 'success');

    if (successfulBranches.length === 0) {
      log.error(COMPONENT, 'No successful branches to judge');
      return {
        confidence: 0,
        synthesis: 'All branches failed. Cannot synthesize.',
      };
    }

    // Build judge prompt
    const branchSummaries = successfulBranches.map((b, i) => {
      return `## Branch ${i + 1}: ${b.fragment_name}

Conversation ID: ${b.conversation_id}
Tokens used: ${b.tokens_used}
`;
    });

    const judgePrompt = `You are evaluating multiple exploration branches for a problem-solving task.

${branchSummaries.join('\n\n')}

Your task:
1. Review the approaches taken in each branch
2. Synthesize the best insights into a coherent recommendation
3. Rate your confidence in this synthesis (0.0 to 1.0)

Output format (REQUIRED):
CONFIDENCE: <float 0.0-1.0>
SYNTHESIS:
<your synthesized recommendation>

Be concise. If the branches diverge significantly, express low confidence.
`;

    try {
      const rawOutput = await runHaikuQuery(judgePrompt);

      // Parse confidence and synthesis
      const confidenceMatch = rawOutput.match(/CONFIDENCE:\s*([\d.]+)/i);
      const synthesisMatch = rawOutput.match(/SYNTHESIS:\s*([\s\S]+)/i);

      const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;
      const synthesis = synthesisMatch ? synthesisMatch[1].trim() : rawOutput;

      log.info(COMPONENT, 'Judge verdict', { confidence, synthesisLength: synthesis.length });

      return { confidence, synthesis };
    } catch (err) {
      log.error(COMPONENT, 'Judge failed', {
        error: err instanceof Error ? err.message : String(err),
      });

      return {
        confidence: 0,
        synthesis: 'Judge execution failed.',
      };
    }
  }

  /**
   * Summarize conversation history from transcript
   */
  private async summarizeConversation(transcriptPath: string): Promise<string> {
    const transcript = await fs.promises.readFile(transcriptPath, 'utf-8');

    // Use haiku to generate summary
    const prompt = `Summarize this conversation transcript in 200-300 words. Focus on the problem being solved and the current state of progress:

${transcript.slice(0, 10000)} ${transcript.length > 10000 ? '...(truncated)' : ''}

Return ONLY the summary, no preamble.`;

    return runHaikuQuery(prompt);
  }

  /**
   * Write exploration dataset (JSONL, one file per exploration)
   */
  private writeExplorationDataset(explorationId: string, rounds: ExplorationRecord[]): void {
    const filename = `${explorationId}.jsonl`;
    const filepath = path.join(this.explorationDir, filename);

    // Ensure directory exists
    if (!fs.existsSync(this.explorationDir)) {
      fs.mkdirSync(this.explorationDir, { recursive: true });
    }

    // Write JSONL (one line per round)
    const lines = rounds.map((r) => JSON.stringify(r)).join('\n') + '\n';
    fs.writeFileSync(filepath, lines, 'utf-8');

    log.info(COMPONENT, 'Exploration dataset written', {
      explorationId,
      filepath,
      rounds: rounds.length,
    });
  }
}

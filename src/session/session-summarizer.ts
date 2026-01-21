/**
 * SessionSummarizer - Haiku-powered session summarization
 *
 * Generates headlines and summaries from session transcripts using Claude 3.5 Haiku.
 * User requirement: Headlines are generated from intro task + final answer only,
 * NOT the full transcript.
 */

import type Anthropic from '@anthropic-ai/sdk';
import fs from 'node:fs/promises';
import { SessionStore } from './session-store.ts';
import type { SummaryType } from './types.ts';
import { log } from '../shared/logger.ts';
import { getAnthropicClient } from '../shared/anthropic-client.ts';

const COMPONENT = 'session-summarizer';

export class SessionSummarizer {
  private client: Anthropic;
  private store: SessionStore;

  constructor(store: SessionStore) {
    this.client = getAnthropicClient();
    this.store = store;
  }

  /**
   * Generate headline from intro task + final answer
   * User requirement: Do NOT summarize full transcript
   */
  async generateHeadline(transcriptPath: string): Promise<string> {
    const transcript = await fs.readFile(transcriptPath, 'utf-8');
    const intro = this.extractIntroTask(transcript);
    const final = this.extractFinalAnswer(transcript);

    const response = await this.client.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: `Generate a 1-line headline (max 80 chars) for this session:

Task: ${intro.slice(0, 500)}

Final Answer: ${final.slice(0, 1000)}

Return ONLY the headline, no quotes or prefix.`
      }]
    });

    return (response.content[0] as { text: string }).text.trim();
  }

  /**
   * Generate summary on demand, with caching
   */
  async summarize(sessionId: string, type: SummaryType): Promise<string> {
    // Check cache
    const cached = this.store.getCachedSummary(sessionId, type);
    if (cached) {
      log.debug(COMPONENT, 'Using cached summary', { sessionId, type });
      return cached;
    }

    // Get session
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const transcript = await fs.readFile(session.transcriptPath, 'utf-8');
    let content: string;

    switch (type) {
      case 'full':
        return transcript;

      case 'final-answer':
        content = await this.generateFinalAnswer(transcript);
        break;

      case 'summary':
        content = await this.generateBriefSummary(transcript);
        break;

      case 'split-summary':
        content = await this.generateSplitSummary(transcript);
        break;

      default:
        throw new Error(`Unknown summary type: ${type}`);
    }

    // Cache result
    this.store.cacheSummary(sessionId, type, content);
    return content;
  }

  private extractIntroTask(transcript: string): string {
    // Find first user message (after frontmatter)
    const lines = transcript.split('\n');
    let inUserBlock = false;
    const content: string[] = [];

    for (const line of lines) {
      if (line.startsWith('## User') || line.startsWith('**User**')) {
        inUserBlock = true;
        continue;
      }
      if (inUserBlock && (line.startsWith('## ') || line.startsWith('**Assistant'))) {
        break;
      }
      if (inUserBlock) {
        content.push(line);
      }
    }

    return content.join('\n').trim() || transcript.slice(0, 500);
  }

  private extractFinalAnswer(transcript: string): string {
    // Find last assistant block
    const blocks = transcript.split(/(?=## Assistant|(?=\*\*Assistant))/);
    const lastBlock = blocks[blocks.length - 1] || '';
    return lastBlock.slice(0, 2000);
  }

  private async generateBriefSummary(transcript: string): Promise<string> {
    const response = await this.client.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Summarize this agent session in 2-3 sentences. Focus on:
- Main task/question
- Key outcome or decision
- Any notable artifacts created

Session transcript:
${transcript.slice(0, 10000)}`
      }]
    });

    return (response.content[0] as { text: string }).text;
  }

  private async generateFinalAnswer(transcript: string): Promise<string> {
    const response = await this.client.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Extract only the final answer or output from this session.
If the session produced code, include the key code.
If it was a discussion, summarize the conclusion.

Session transcript:
${transcript.slice(-15000)}`
      }]
    });

    return (response.content[0] as { text: string }).text;
  }

  private async generateSplitSummary(transcript: string): Promise<string> {
    const intro = this.extractIntroTask(transcript);
    const halfPoint = Math.floor(transcript.length / 2);
    const latterHalf = transcript.slice(halfPoint);

    const response = await this.client.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Summarize the latter half of this session.

## Original Task
${intro}

## Latter Half to Summarize
${latterHalf.slice(0, 10000)}

Format:
## Conversation Summary
[Summary]

## Outcome
[Final status/output]`
      }]
    });

    return `## Original Task\n${intro}\n\n${(response.content[0] as { text: string }).text}`;
  }
}

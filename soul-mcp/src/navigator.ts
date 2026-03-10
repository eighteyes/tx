/**
 * Soul Navigator
 *
 * Fog-of-war navigation for the opus-soul knowledge graph.
 * Provides single navigate() method with bidirectional link support.
 */

import { readdir, access } from 'fs/promises';
import { join } from 'path';
import { parseFile, extractNodeName } from './parser.js';
import {
  NavigateResponse,
  IndexResponse,
  Direction,
  Directions,
  NavigateArgs,
  WikiLink,
} from './types.js';
import { log } from './logger.js';

export class SoulNavigator {
  private graphRoot: string;
  private incomingIndex: Map<string, string[]> | null = null;

  constructor(graphRoot: string) {
    this.graphRoot = graphRoot;
  }

  /**
   * Navigate to a node in the graph
   *
   * Returns full content + bidirectional links (fog-of-war navigation)
   */
  async navigate(args: NavigateArgs): Promise<NavigateResponse | IndexResponse> {
    const { node } = args;

    // Special case: _index returns entry points
    if (node === '_index') {
      return this.getIndexResponse();
    }

    // Resolve node to file path
    const resolved = await this.resolveNode(node);

    if (!resolved) {
      throw new Error(
        `Node not found: ${node}. Try navigate({node: "_index"}) for entry points.`
      );
    }

    const { filepath, type } = resolved;

    // Parse file content and extract links
    const { content, metadata, links } = await parseFile(filepath);

    // Build bidirectional directions
    const directions = await this.buildDirections(node, links);

    return {
      node,
      type,
      path: filepath,
      content,
      directions,
      metadata: {
        maturity: metadata.maturity as string | undefined,
        resonance: metadata.resonance as string | number | undefined,
        finder: metadata.finder as string | undefined,
        voices: metadata.voices as string[] | undefined,
        ...metadata,
      },
    };
  }

  /**
   * Build incoming link index (which files link TO each file)
   */
  private async buildIncomingIndex(): Promise<void> {
    if (this.incomingIndex) return; // Already built

    log.info('soul-navigator', 'Building incoming link index...');

    this.incomingIndex = new Map();

    const dirs = ['concepts', 'threads'];

    for (const dir of dirs) {
      const dirPath = join(this.graphRoot, dir);

      try {
        const files = await readdir(dirPath);

        for (const file of files) {
          if (!file.endsWith('.md')) continue;

          const filepath = join(dirPath, file);
          const nodeName = extractNodeName(filepath);

          try {
            const { links } = await parseFile(filepath);

            // For each outgoing link from this file, register it as incoming to the target
            for (const link of links) {
              const targetName = this.extractTargetName(link.target);

              if (!this.incomingIndex.has(targetName)) {
                this.incomingIndex.set(targetName, []);
              }

              const incomingList = this.incomingIndex.get(targetName)!;
              if (!incomingList.includes(nodeName)) {
                incomingList.push(nodeName);
              }
            }
          } catch (err) {
            log.error('soul-navigator', `Failed to parse ${filepath}`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        // Directory doesn't exist - skip
        log.warn('soul-navigator', `Directory not found: ${dirPath}`);
      }
    }

    log.info('soul-navigator', 'Incoming link index built', {
      nodes: this.incomingIndex.size,
    });
  }

  /**
   * Extract clean target name from wiki-link
   * E.g., "concepts/distributed-soul" → "distributed-soul"
   */
  private extractTargetName(target: string): string {
    const cleanTarget = target.replace(/\.md$/, '');

    if (cleanTarget.includes('/')) {
      const parts = cleanTarget.split('/');
      return parts[parts.length - 1];
    }

    return cleanTarget;
  }

  /**
   * Build bidirectional directions for a node
   */
  private async buildDirections(
    nodeName: string,
    outgoingLinks: WikiLink[]
  ): Promise<Directions> {
    // Build outgoing directions
    const outgoing: Direction[] = [];

    for (const link of outgoingLinks) {
      const targetName = this.extractTargetName(link.target);
      const resolved = await this.resolveNode(targetName);

      if (resolved) {
        outgoing.push({
          name: targetName,
          type: resolved.type,
          context: link.context,
        });
      } else {
        // Orphan link (target doesn't exist)
        outgoing.push({
          name: targetName,
          type: 'orphan',
          context: link.context,
        });
      }
    }

    // Build incoming directions
    await this.buildIncomingIndex();

    const incoming: Direction[] = [];
    const incomingNodes = this.incomingIndex!.get(nodeName) || [];

    for (const incomingNode of incomingNodes) {
      const resolved = await this.resolveNode(incomingNode);

      if (resolved) {
        incoming.push({
          name: incomingNode,
          type: resolved.type,
          context: 'incoming-reference',
        });
      }
    }

    return { outgoing, incoming };
  }

  /**
   * Resolve a node name to file path
   *
   * Rules:
   * - Try concepts/name.md first
   * - Then try threads/name.md
   * - Handle explicit paths like "concepts/name" or "threads/name"
   */
  private async resolveNode(
    node: string
  ): Promise<{ filepath: string; type: 'concept' | 'thread' } | null> {
    const cleanNode = node.replace(/\.md$/, '');

    // Explicit path
    if (cleanNode.startsWith('concepts/')) {
      const name = cleanNode.replace('concepts/', '');
      const filepath = join(this.graphRoot, 'concepts', `${name}.md`);
      if (await this.fileExists(filepath)) {
        return { filepath, type: 'concept' };
      }
      return null;
    }

    if (cleanNode.startsWith('threads/')) {
      const name = cleanNode.replace('threads/', '');
      const filepath = join(this.graphRoot, 'threads', `${name}.md`);
      if (await this.fileExists(filepath)) {
        return { filepath, type: 'thread' };
      }
      return null;
    }

    // Implicit: try concepts first, then threads
    const conceptPath = join(this.graphRoot, 'concepts', `${cleanNode}.md`);
    if (await this.fileExists(conceptPath)) {
      return { filepath: conceptPath, type: 'concept' };
    }

    const threadPath = join(this.graphRoot, 'threads', `${cleanNode}.md`);
    if (await this.fileExists(threadPath)) {
      return { filepath: threadPath, type: 'thread' };
    }

    return null;
  }

  /**
   * Check if file exists
   */
  private async fileExists(filepath: string): Promise<boolean> {
    try {
      await access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get index response with entry points
   */
  private async getIndexResponse(): Promise<IndexResponse> {
    const entryPoints: Array<{
      name: string;
      type: 'concept' | 'thread';
      description?: string;
    }> = [];

    // Check if index.md exists
    const indexPath = join(this.graphRoot, 'index.md');
    if (await this.fileExists(indexPath)) {
      entryPoints.push({
        name: 'index',
        type: 'concept',
        description: 'Master index',
      });
    }

    // List a few popular concepts (first 5 alphabetically)
    try {
      const conceptsDir = join(this.graphRoot, 'concepts');
      const concepts = await readdir(conceptsDir);

      for (const file of concepts.slice(0, 5)) {
        if (file.endsWith('.md')) {
          const name = file.replace(/\.md$/, '');
          entryPoints.push({ name, type: 'concept' });
        }
      }
    } catch {
      // concepts/ doesn't exist
    }

    // List a few threads (first 3 alphabetically)
    try {
      const threadsDir = join(this.graphRoot, 'threads');
      const threads = await readdir(threadsDir);

      for (const file of threads.slice(0, 3)) {
        if (file.endsWith('.md')) {
          const name = file.replace(/\.md$/, '');
          entryPoints.push({ name, type: 'thread' });
        }
      }
    } catch {
      // threads/ doesn't exist
    }

    return {
      type: 'index',
      entryPoints,
    };
  }
}

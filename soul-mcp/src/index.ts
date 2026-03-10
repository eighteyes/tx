#!/usr/bin/env node

/**
 * Soul Navigator MCP Server Entry Point
 *
 * Fog-of-war navigation for the opus-soul knowledge graph.
 *
 * Usage:
 *   soul-mcp [graph-root-path]
 *
 * Default: .ai/know/opus-soul (relative to cwd)
 */

import { resolve } from 'path';
import { SoulMCPServer } from './server.js';
import { log } from './logger.js';

async function main() {
  // Get graph root from args or default to .ai/know/opus-soul
  const graphRoot = process.argv[2]
    ? resolve(process.argv[2])
    : resolve(process.cwd(), '.ai/know/opus-soul');

  log.info('soul-navigator', 'Soul Navigator MCP server starting...', { graphRoot });

  const server = new SoulMCPServer(graphRoot);
  await server.start();
}

main().catch((error) => {
  log.error('soul-navigator', 'Fatal error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});

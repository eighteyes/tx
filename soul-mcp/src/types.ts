/**
 * Soul Navigator Types
 *
 * Fog-of-war navigation for the opus-soul knowledge graph.
 * Single-tool design: see current node + immediate neighbors only.
 */

/**
 * Direction/link to another node
 */
export interface Direction {
  /** Node name (e.g., "distributed-soul") */
  name: string;
  /** Node type: concept, thread, or orphan (link exists but file doesn't) */
  type: 'concept' | 'thread' | 'orphan';
  /** Context: where this link came from (frontmatter field, body, etc.) */
  context?: string;
}

/**
 * Bidirectional links for a node
 */
export interface Directions {
  /** Links going OUT from this node (in frontmatter + body) */
  outgoing: Direction[];
  /** Links coming IN to this node (other files that reference it) */
  incoming: Direction[];
}

/**
 * Node metadata from frontmatter
 */
export interface NodeMetadata {
  /** Maturity level (seed, sapling, tree, etc.) */
  maturity?: string;
  /** Resonance level (0-5 or ●●●) */
  resonance?: string | number;
  /** Finder agent (oracle, creative, brain, etc.) */
  finder?: string;
  /** Voices involved */
  voices?: string[];
  /** Any other frontmatter fields */
  [key: string]: unknown;
}

/**
 * Response from navigate tool
 */
export interface NavigateResponse {
  /** Node name */
  node: string;
  /** Node type */
  type: 'concept' | 'thread' | 'index';
  /** Full file path */
  path: string;
  /** Full markdown content (including frontmatter) */
  content: string;
  /** Available directions (outgoing + incoming) */
  directions: Directions;
  /** Extracted metadata */
  metadata: NodeMetadata;
}

/**
 * Special index response for entry point discovery
 */
export interface IndexResponse {
  type: 'index';
  /** Entry points for navigation */
  entryPoints: Array<{
    name: string;
    type: 'concept' | 'thread';
    description?: string;
  }>;
}

/**
 * Arguments for navigate tool
 */
export interface NavigateArgs {
  /** Node to navigate to (e.g., "distributed-soul", "_index") */
  node: string;
  /** Optional: custom graph path (defaults to .ai/know/opus-soul) */
  graphPath?: string;
}

/**
 * Internal: parsed wiki-link
 */
export interface WikiLink {
  /** Raw link text (e.g., "[[distributed-soul]]") */
  raw: string;
  /** Target node name */
  target: string;
  /** Context where found (frontmatter field name, "body", etc.) */
  context: string;
}

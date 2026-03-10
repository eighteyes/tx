/**
 * Wiki-Link Parser
 *
 * Extracts [[wiki-links]] from markdown frontmatter and body.
 * Handles both in-text links and frontmatter relationship fields.
 */

import { readFile } from 'fs/promises';
import { WikiLink, NodeMetadata } from './types.js';

const WIKI_LINK_REGEX = /\[\[([^\]]+)\]\]/g;

/**
 * Parse a markdown file and extract frontmatter + wiki-links
 */
export async function parseFile(filepath: string): Promise<{
  content: string;
  body: string;
  metadata: NodeMetadata;
  links: WikiLink[];
}> {
  const content = await readFile(filepath, 'utf-8');
  const { metadata, body } = extractFrontmatter(content);
  const links = extractAllLinks(metadata, body);

  return { content, body, metadata, links };
}

/**
 * Extract YAML frontmatter from markdown content
 */
function extractFrontmatter(content: string): {
  metadata: NodeMetadata;
  body: string;
} {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { metadata: {}, body: content };
  }

  const [, yamlContent, body] = frontmatterMatch;
  const metadata = parseYAML(yamlContent);

  return { metadata, body };
}

/**
 * Simple YAML parser for frontmatter
 * Handles basic key-value pairs and arrays
 */
function parseYAML(yamlContent: string): NodeMetadata {
  const metadata: NodeMetadata = {};
  const lines = yamlContent.split('\n');

  let currentKey: string | null = null;
  let currentArray: unknown[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Array item
    if (trimmed.startsWith('-')) {
      const value = trimmed.slice(1).trim();
      const cleanValue = cleanQuotes(value);
      currentArray.push(cleanValue);
      continue;
    }

    // Key-value pair
    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      // Save previous array if exists
      if (currentKey && currentArray.length > 0) {
        metadata[currentKey] = currentArray;
        currentArray = [];
      }

      currentKey = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();

      if (value) {
        // Inline value
        metadata[currentKey] = parseValue(value);
        currentKey = null;
      }
      // else: array follows
    }
  }

  // Save final array if exists
  if (currentKey && currentArray.length > 0) {
    metadata[currentKey] = currentArray;
  }

  return metadata;
}

/**
 * Remove quotes from YAML string values
 */
function cleanQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Parse YAML value (string, number, boolean, null)
 */
function parseValue(value: string): unknown {
  const clean = cleanQuotes(value);

  // Boolean
  if (clean === 'true') return true;
  if (clean === 'false') return false;

  // Null
  if (clean === 'null' || clean === '~') return null;

  // Number
  const num = Number(clean);
  if (!isNaN(num) && clean !== '') return num;

  // String
  return clean;
}

/**
 * Extract all wiki-links from frontmatter and body
 */
function extractAllLinks(metadata: NodeMetadata, body: string): WikiLink[] {
  const links: WikiLink[] = [];

  // Extract from frontmatter fields that contain links
  const linkFields = [
    'related',
    'orthogonal',
    'parent',
    'children',
    'concepts_woven',
  ];

  for (const field of linkFields) {
    const value = metadata[field];

    if (typeof value === 'string') {
      // Single link
      const extracted = extractLinksFromText(value, field);
      links.push(...extracted);
    } else if (Array.isArray(value)) {
      // Array of links
      for (const item of value) {
        if (typeof item === 'string') {
          const extracted = extractLinksFromText(item, field);
          links.push(...extracted);
        }
      }
    }
  }

  // Extract from body
  const bodyLinks = extractLinksFromText(body, 'body');
  links.push(...bodyLinks);

  return deduplicateLinks(links);
}

/**
 * Extract wiki-links from a text string
 */
function extractLinksFromText(text: string, context: string): WikiLink[] {
  const links: WikiLink[] = [];
  const matches = text.matchAll(WIKI_LINK_REGEX);

  for (const match of matches) {
    const raw = match[0];
    const target = match[1].trim();

    links.push({ raw, target, context });
  }

  return links;
}

/**
 * Deduplicate links by target (keep first occurrence)
 */
function deduplicateLinks(links: WikiLink[]): WikiLink[] {
  const seen = new Set<string>();
  const unique: WikiLink[] = [];

  for (const link of links) {
    if (!seen.has(link.target)) {
      seen.add(link.target);
      unique.push(link);
    }
  }

  return unique;
}

/**
 * Resolve wiki-link target to file path
 *
 * Rules:
 * - [[name]] → Try concepts/name.md, then threads/name.md
 * - [[concepts/name]] → concepts/name.md
 * - [[threads/name]] → threads/name.md
 */
export function resolveLinkPath(
  target: string,
  graphRoot: string
): { path: string; type: 'concept' | 'thread' } | null {
  // Remove .md extension if present
  const cleanTarget = target.replace(/\.md$/, '');

  // Explicit path
  if (cleanTarget.startsWith('concepts/')) {
    return {
      path: `${graphRoot}/${cleanTarget}.md`,
      type: 'concept',
    };
  }

  if (cleanTarget.startsWith('threads/')) {
    return {
      path: `${graphRoot}/${cleanTarget}.md`,
      type: 'thread',
    };
  }

  // Implicit: try concepts first, then threads
  // Return null - caller will check both concepts/ and threads/
  return null;
}

/**
 * Extract node name from file path
 * E.g., "/path/concepts/distributed-soul.md" → "distributed-soul"
 */
export function extractNodeName(filepath: string): string {
  const parts = filepath.split('/');
  const filename = parts[parts.length - 1];
  return filename.replace(/\.md$/, '');
}

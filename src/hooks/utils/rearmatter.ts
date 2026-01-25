/**
 * Rearmatter Extraction
 *
 * Extracts self-assessment data from worker output.
 * Rearmatter contains confidence scores, grades, tool call counts, etc.
 */

import type { RearmatterData } from '../../quality/types.ts';

/**
 * Extract rearmatter (self-assessment) from worker output
 */
export function extractRearmatter(solution: string): RearmatterData {
  const rearmatter: RearmatterData = {};

  // Extract confidence score (e.g., "confidence: 0.85" or "Confidence: 85%")
  const confidenceMatch = solution.match(/confidence[:\s]+(\d*\.?\d+)%?/i);
  if (confidenceMatch) {
    let confidence = parseFloat(confidenceMatch[1]);
    // Convert percentage to decimal if > 1
    if (confidence > 1) {
      confidence = confidence / 100;
    }
    rearmatter.confidence = confidence;
  }

  // Extract grade (e.g., "grade: B" or "Grade: A")
  const gradeMatch = solution.match(/grade[:\s]+([A-F][+-]?)/i);
  if (gradeMatch) {
    rearmatter.grade = gradeMatch[1].toUpperCase();
  }

  // Count tool calls from output markers
  const toolMatches = solution.match(/\[Tools?:/gi);
  if (toolMatches) {
    rearmatter.toolCalls = toolMatches.length;
  }

  // Extract assumptions (look for bulleted lists after "Assumptions:")
  const assumptionsMatch = solution.match(/assumptions?:\s*\n((?:\s*[-*]\s*.+\n?)+)/i);
  if (assumptionsMatch) {
    const items = assumptionsMatch[1].match(/[-*]\s*(.+)/g);
    if (items) {
      rearmatter.assumptions = items.map(item => item.replace(/^[-*]\s*/, '').trim());
    }
  }

  // Extract limitations (look for bulleted lists after "Limitations:")
  const limitationsMatch = solution.match(/limitations?:\s*\n((?:\s*[-*]\s*.+\n?)+)/i);
  if (limitationsMatch) {
    const items = limitationsMatch[1].match(/[-*]\s*(.+)/g);
    if (items) {
      rearmatter.limitations = items.map(item => item.replace(/^[-*]\s*/, '').trim());
    }
  }

  // Extract sources (look for URLs or "Source:" markers)
  const sourceUrls = solution.match(/https?:\/\/[^\s)>\]]+/g);
  if (sourceUrls && sourceUrls.length > 0) {
    rearmatter.sources = sourceUrls.map(url => ({
      url,
      type: classifySourceType(url),
    }));
  }

  return rearmatter;
}

/**
 * Classify source type based on URL domain
 */
function classifySourceType(url: string): 'first-party' | 'second-party' | 'unknown' {
  try {
    const parsed = new URL(url);
    const domain = parsed.hostname.toLowerCase();

    // First-party: official documentation sites
    const firstPartyDomains = [
      'docs.github.com',
      'developer.mozilla.org',
      'nodejs.org',
      'typescriptlang.org',
      'react.dev',
      'vuejs.org',
      'angular.io',
      'python.org',
      'go.dev',
      'rust-lang.org',
      'docs.rs',
      'crates.io',
      'npmjs.com',
      'pypi.org',
    ];

    if (firstPartyDomains.some(d => domain.includes(d))) {
      return 'first-party';
    }

    // Second-party: reputable but unofficial sources
    const secondPartyDomains = [
      'stackoverflow.com',
      'github.com',
      'medium.com',
      'dev.to',
      'hackernoon.com',
    ];

    if (secondPartyDomains.some(d => domain.includes(d))) {
      return 'second-party';
    }

    return 'unknown';
  } catch {
    return 'unknown';
  }
}

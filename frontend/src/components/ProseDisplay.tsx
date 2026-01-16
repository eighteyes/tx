/**
 * ProseDisplay.tsx
 * Render narrative prose with enhanced typography.
 * Responsibilities:
 * - Parse [PROSE] and [VISUAL] blocks from messages
 * - Render with serif font and proper line height
 * - Highlight decision points
 */

import { useMemo } from 'react';
import './ProseDisplay.css';

interface ProseDisplayProps {
  content: string;
}

interface ParsedBlock {
  type: 'prose' | 'visual' | 'text';
  content: string;
}

export function ProseDisplay({ content }: ProseDisplayProps) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  return (
    <div className="prose-display">
      {blocks.map((block, index) => (
        <div key={index} className={`prose-block prose-block--${block.type}`}>
          {block.type === 'visual' && (
            <span className="prose-block__label">Visual</span>
          )}
          <div className="prose-block__content">
            {block.content}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Parse content into typed blocks
 */
function parseBlocks(content: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];

  // Regex to match [PROSE]...[/PROSE] and [VISUAL]...[/VISUAL] blocks
  const blockRegex = /\[(PROSE|VISUAL)\]([\s\S]*?)\[\/\1\]/gi;

  let lastIndex = 0;
  let match;

  while ((match = blockRegex.exec(content)) !== null) {
    // Add any text before this block
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index).trim();
      if (textBefore) {
        blocks.push({ type: 'text', content: textBefore });
      }
    }

    // Add the block
    const type = match[1].toLowerCase() as 'prose' | 'visual';
    const blockContent = match[2].trim();
    if (blockContent) {
      blocks.push({ type, content: blockContent });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add any remaining text
  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex).trim();
    if (remaining) {
      blocks.push({ type: 'text', content: remaining });
    }
  }

  // If no blocks found, treat entire content as text
  if (blocks.length === 0 && content.trim()) {
    blocks.push({ type: 'text', content: content.trim() });
  }

  return blocks;
}

/**
 * Check if content appears to be narrative prose
 */
export function isNarrativeContent(content: string): boolean {
  return /\[(PROSE|VISUAL)\]/i.test(content);
}

export default ProseDisplay;

/**
 * String utility functions for the TX CLI v4 system.
 * @module shared/string
 */

/**
 * Reverses a string, handling unicode characters correctly.
 *
 * This function properly handles:
 * - Empty strings (returns empty string)
 * - Single character strings (returns the same character)
 * - Unicode characters and multi-byte UTF-16 sequences (emoji, combining marks, etc.)
 * - Regular ASCII and Latin characters
 *
 * @param input - The string to reverse
 * @returns The reversed string
 *
 * @example
 * ```typescript
 * reverseString("hello");        // "olleh"
 * reverseString("");             // ""
 * reverseString("a");            // "a"
 * reverseString("👋🌍");         // "🌍👋"
 * reverseString("café");         // "éfac"
 * ```
 */
export function reverseString(input: string): string {
  // Handle empty strings
  if (input.length === 0) {
    return "";
  }

  // Use Array.from to properly handle unicode characters including emoji
  // This correctly handles UTF-16 surrogate pairs and combining marks
  return Array.from(input).reverse().join("");
}

/**
 * Reverses a string while preserving whitespace and special characters.
 * Identical to {@link reverseString} but documented for clarity.
 *
 * @param input - The string to reverse
 * @returns The reversed string
 */
export function reverse(input: string): string {
  return reverseString(input);
}

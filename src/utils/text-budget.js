// Text budget utilities for RAG context sizing
// Uses character-based estimation (no external dependency)

/**
 * Estimate word-piece count for text. 3.5 chars/unit balances EN/ES mixed content.
 */
export function estimateTokens(text, charsPerToken = 3.5) {
  if (!text) return 0;
  return Math.ceil(text.length / charsPerToken);
}

/**
 * Truncate text to fit within a budget, breaking at the last newline boundary.
 */
export function truncateToTokens(text, maxTokens, charsPerToken = 3.5) {
  if (!text) return '';
  const maxChars = Math.floor(maxTokens * charsPerToken);
  if (text.length <= maxChars) return text;

  const truncated = text.slice(0, maxChars);
  const lastNewline = truncated.lastIndexOf('\n');
  return lastNewline > 0 ? truncated.slice(0, lastNewline) : truncated;
}

/**
 * Generate a short snippet from content, stripping markdown headers.
 */
export function generateSnippet(content, maxLength = 200) {
  if (!content) return '';
  const stripped = content.replace(/^#{1,6}\s+.*$/gm, '').trim();
  if (stripped.length <= maxLength) return stripped;
  return stripped.slice(0, maxLength) + '...';
}

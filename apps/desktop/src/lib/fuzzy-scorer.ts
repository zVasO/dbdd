/**
 * Fuzzy scoring module for database IDE autocomplete.
 * Pure functions, no side effects, no dependencies.
 * Designed to run inside a Web Worker for 500+ tables / 10K+ columns in <5ms.
 *
 * Performance strategy:
 * - Exact/prefix/substring checks are O(n) string ops — very fast
 * - Fuzzy path uses aggressive pre-filters to skip 90%+ of candidates
 * - DL uses reusable flat Uint16Array — zero allocation per call
 */

export type ScoreResult = {
  readonly score: number;
  readonly matches: readonly [number, number][];
};

const NO_MATCH: ScoreResult = { score: 0, matches: [] };

/**
 * Returns the maximum allowed edit distance for a given input length.
 * - 1-4 chars: 1 edit
 * - 5-8 chars: 2 edits
 * - 9+  chars: 3 edits
 */
function maxEdits(length: number): number {
  if (length <= 4) return 1;
  if (length <= 8) return 2;
  return 3;
}

// Pre-allocated buffer for DL matrix (max 64x64 — sufficient for SQL identifiers)
const DL_MAX = 64;
const dlBuffer = new Uint16Array((DL_MAX + 1) * (DL_MAX + 1));

/**
 * Damerau-Levenshtein distance using a pre-allocated flat buffer.
 * Zero allocations per call. Supports insertions, deletions,
 * substitutions, and transpositions.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;

  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  // Fall back to simple length diff if strings are too long for buffer
  if (lenA > DL_MAX || lenB > DL_MAX) {
    return Math.abs(lenA - lenB);
  }

  const stride = lenB + 1;

  // Initialize first row and column
  for (let i = 0; i <= lenA; i++) dlBuffer[i * stride] = i;
  for (let j = 0; j <= lenB; j++) dlBuffer[j] = j;

  for (let i = 1; i <= lenA; i++) {
    const rowOffset = i * stride;
    const prevRowOffset = (i - 1) * stride;

    for (let j = 1; j <= lenB; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;

      let val = Math.min(
        dlBuffer[prevRowOffset + j] + 1,       // deletion
        dlBuffer[rowOffset + j - 1] + 1,       // insertion
        dlBuffer[prevRowOffset + j - 1] + cost  // substitution
      );

      // transposition
      if (
        i > 1 && j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        val = Math.min(val, dlBuffer[(i - 2) * stride + j - 2] + 1);
      }

      dlBuffer[rowOffset + j] = val;
    }
  }

  return dlBuffer[lenA * stride + lenB];
}

/**
 * Quick check: does input share enough characters with target?
 * Uses a 26-bit bitmask for lowercase a-z — O(n) with zero allocation.
 */
function hasCharacterOverlap(input: string, target: string, minRequired: number): boolean {
  // Build bitmask of target characters
  let targetMask = 0;
  for (let i = 0; i < target.length; i++) {
    const code = target.charCodeAt(i) - 97; // 'a' = 97
    if (code >= 0 && code < 26) targetMask |= (1 << code);
  }

  let found = 0;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i) - 97;
    if (code >= 0 && code < 26 && (targetMask & (1 << code))) {
      found++;
      if (found >= minRequired) return true;
    }
  }
  return found >= minRequired;
}

/**
 * Scores how well `input` matches `target` on a 0-100 scale.
 *
 * Tiers:
 * - Exact match:     100
 * - Prefix match:    85-99  (scaled by length ratio)
 * - Substring match: 60-84  (scaled by length ratio)
 * - Fuzzy match:     20-59  (DL-based with aggressive pre-filtering)
 * - No match:        0
 */
export function fuzzyScore(input: string, target: string): ScoreResult {
  if (input.length === 0) return NO_MATCH;

  const lowerInput = input.toLowerCase();
  const lowerTarget = target.toLowerCase();

  // Exact match
  if (lowerInput === lowerTarget) {
    return { score: 100, matches: [[0, target.length]] };
  }

  // Prefix match
  if (lowerTarget.startsWith(lowerInput)) {
    const ratio = lowerInput.length / lowerTarget.length;
    const score = Math.round(85 + ratio * 14);
    return { score, matches: [[0, input.length]] };
  }

  // Substring match
  const subIdx = lowerTarget.indexOf(lowerInput);
  if (subIdx !== -1) {
    const ratio = lowerInput.length / lowerTarget.length;
    const score = Math.round(60 + ratio * 24);
    return { score, matches: [[subIdx, subIdx + input.length]] };
  }

  // --- Fuzzy match with aggressive pre-filtering ---
  const allowed = maxEdits(lowerInput.length);

  // Pre-filter 1: length difference too large → impossible to match within edit distance
  const lenDiff = Math.abs(lowerInput.length - lowerTarget.length);
  if (lenDiff > allowed) {
    // For substring fuzzy, target can be longer but input must fit somewhere.
    // Only proceed if target is longer (input could be a fuzzy substring).
    if (lowerTarget.length <= lowerInput.length) return NO_MATCH;
  }

  // Pre-filter 2: character overlap using bitmask (zero allocation)
  const minCharsRequired = lowerInput.length - allowed;
  if (!hasCharacterOverlap(lowerInput, lowerTarget, minCharsRequired)) {
    return NO_MATCH;
  }

  // Full-string DL (only when lengths are similar)
  if (lenDiff <= allowed) {
    const fullDist = damerauLevenshtein(lowerInput, lowerTarget);
    if (fullDist <= allowed) {
      const ratio = 1 - fullDist / Math.max(lowerInput.length, 1);
      const score = Math.round(20 + ratio * 39);
      return { score, matches: [[0, lowerTarget.length]] };
    }
  }

  // Substring fuzzy: check windows only at positions where first char of input matches
  if (lowerTarget.length > lowerInput.length) {
    const windowLen = lowerInput.length;
    const firstChar = lowerInput.charCodeAt(0);
    let bestDistance = allowed + 1;
    let bestStart = 0;

    for (let start = 0; start <= lowerTarget.length - windowLen; start++) {
      // Only check windows starting with a matching first character
      if (lowerTarget.charCodeAt(start) !== firstChar) continue;

      const window = lowerTarget.substring(start, start + windowLen);
      const dist = damerauLevenshtein(lowerInput, window);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestStart = start;
      }
      if (bestDistance === 0) break;
    }

    if (bestDistance <= allowed) {
      const ratio = 1 - bestDistance / Math.max(lowerInput.length, 1);
      const score = Math.round(20 + ratio * 39);
      return { score, matches: [[bestStart, bestStart + windowLen]] };
    }
  }

  return NO_MATCH;
}

/**
 * Dot-aware scoring for "table.column" autocomplete.
 *
 * When input contains a dot:
 *   Split into tablePart and columnPart.
 *   Score each against the respective name.
 *   Combined = 0.6 * tableScore + 0.4 * columnScore.
 *   Both parts must score > 0 or result is 0.
 *
 * When input has no dot:
 *   Score against "tableName.columnName" concatenation.
 */
export function scoreDotAware(
  input: string,
  tableName: string,
  columnName: string
): ScoreResult {
  const dotIndex = input.indexOf('.');

  if (dotIndex === -1) {
    const concat = tableName + '.' + columnName;
    return fuzzyScore(input, concat);
  }

  const tablePart = input.substring(0, dotIndex);
  const columnPart = input.substring(dotIndex + 1);

  const tableResult = fuzzyScore(tablePart, tableName);
  const columnResult = fuzzyScore(columnPart, columnName);

  if (tableResult.score === 0 || columnResult.score === 0) {
    return NO_MATCH;
  }

  const combinedScore = Math.round(
    0.6 * tableResult.score + 0.4 * columnResult.score
  );

  // Merge match positions: table matches stay as-is, column matches offset by tableName.length + 1 (for the dot)
  const matches: [number, number][] = [
    ...tableResult.matches.map(
      ([s, e]) => [s, e] as [number, number]
    ),
    ...columnResult.matches.map(
      ([s, e]) => [s + tableName.length + 1, e + tableName.length + 1] as [number, number]
    ),
  ];

  return { score: combinedScore, matches };
}

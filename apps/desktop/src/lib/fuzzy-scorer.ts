/**
 * Fuzzy scoring module for database IDE autocomplete.
 * Pure functions, no side effects, no dependencies.
 * Designed to run inside a Web Worker for 500+ tables / 10K+ columns in <5ms.
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

/**
 * Damerau-Levenshtein distance supporting insertions, deletions,
 * substitutions, and transpositions.
 */
export function damerauLevenshtein(a: string, b: string): number {
  const lenA = a.length;
  const lenB = b.length;

  if (lenA === 0) return lenB;
  if (lenB === 0) return lenA;

  // Matrix with dimensions (lenA+1) x (lenB+1)
  const d: number[][] = [];
  for (let i = 0; i <= lenA; i++) {
    d[i] = new Array(lenB + 1);
    d[i][0] = i;
  }
  for (let j = 0; j <= lenB; j++) {
    d[0][j] = j;
  }

  for (let i = 1; i <= lenA; i++) {
    for (let j = 1; j <= lenB; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;

      d[i][j] = Math.min(
        d[i - 1][j] + 1,       // deletion
        d[i][j - 1] + 1,       // insertion
        d[i - 1][j - 1] + cost // substitution
      );

      // transposition
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + cost);
      }
    }
  }

  return d[lenA][lenB];
}

/**
 * Scores how well `input` matches `target` on a 0-100 scale.
 *
 * Tiers:
 * - Exact match:     100
 * - Prefix match:    85-99  (scaled by length ratio)
 * - Substring match: 60-84  (scaled by length ratio)
 * - Fuzzy match:     20-59  (DL-based, sliding window for substring fuzzy)
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

  // Fuzzy match: sliding window over target
  const allowed = maxEdits(lowerInput.length);
  let bestDistance = Infinity;
  let bestStart = -1;
  let bestEnd = -1;

  // Try windows of varying sizes around the input length
  const minWindow = Math.max(1, lowerInput.length - allowed);
  const maxWindow = Math.min(lowerTarget.length, lowerInput.length + allowed);

  for (let winSize = minWindow; winSize <= maxWindow; winSize++) {
    for (let start = 0; start <= lowerTarget.length - winSize; start++) {
      const window = lowerTarget.substring(start, start + winSize);
      const dist = damerauLevenshtein(lowerInput, window);
      if (dist < bestDistance) {
        bestDistance = dist;
        bestStart = start;
        bestEnd = start + winSize;
      }
      if (bestDistance === 0) break;
    }
    if (bestDistance === 0) break;
  }

  // Also check full target distance
  const fullDist = damerauLevenshtein(lowerInput, lowerTarget);
  if (fullDist < bestDistance) {
    bestDistance = fullDist;
    bestStart = 0;
    bestEnd = lowerTarget.length;
  }

  if (bestDistance <= allowed && bestDistance > 0) {
    // Scale 20-59 based on how close the match is
    const ratio = 1 - bestDistance / Math.max(lowerInput.length, 1);
    const score = Math.round(20 + ratio * 39);
    return { score, matches: [[bestStart, bestEnd]] };
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

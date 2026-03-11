import { describe, it, expect } from 'vitest';
import {
  damerauLevenshtein,
  fuzzyScore,
  scoreDotAware,
  type ScoreResult,
} from '../fuzzy-scorer';

describe('damerauLevenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(damerauLevenshtein('abc', 'abc')).toBe(0);
  });

  it('handles insertion', () => {
    expect(damerauLevenshtein('abc', 'abcd')).toBe(1);
  });

  it('handles deletion', () => {
    expect(damerauLevenshtein('abcd', 'abc')).toBe(1);
  });

  it('handles substitution', () => {
    expect(damerauLevenshtein('abc', 'axc')).toBe(1);
  });

  it('handles transposition', () => {
    expect(damerauLevenshtein('ab', 'ba')).toBe(1);
    expect(damerauLevenshtein('abc', 'bac')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(damerauLevenshtein('', '')).toBe(0);
    expect(damerauLevenshtein('abc', '')).toBe(3);
    expect(damerauLevenshtein('', 'abc')).toBe(3);
  });

  it('handles multiple edits', () => {
    expect(damerauLevenshtein('kitten', 'sitting')).toBe(3);
  });
});

describe('fuzzyScore', () => {
  it('returns 100 for exact match', () => {
    const result = fuzzyScore('users', 'users');
    expect(result.score).toBe(100);
  });

  it('returns 100 for exact match case insensitive', () => {
    const result = fuzzyScore('Users', 'users');
    expect(result.score).toBe(100);
  });

  it('returns 85-99 for prefix match', () => {
    const result = fuzzyScore('use', 'users');
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.score).toBeLessThanOrEqual(99);
  });

  it('scores shorter prefix higher than longer target for same input', () => {
    const short = fuzzyScore('use', 'users');
    const long = fuzzyScore('use', 'users_extended_table');
    expect(short.score).toBeGreaterThan(long.score);
  });

  it('returns 60-84 for substring match', () => {
    const result = fuzzyScore('name', 'username');
    expect(result.score).toBeGreaterThanOrEqual(60);
    expect(result.score).toBeLessThanOrEqual(84);
  });

  it('scores table higher than table.column for same input (no dot)', () => {
    const tableScore = fuzzyScore('users', 'users');
    const dotScore = fuzzyScore('users', 'users.id');
    expect(tableScore.score).toBeGreaterThan(dotScore.score);
  });

  it('returns 20-59 for fuzzy match with typo', () => {
    const result = fuzzyScore('usres', 'users');
    expect(result.score).toBeGreaterThanOrEqual(20);
    expect(result.score).toBeLessThanOrEqual(59);
  });

  it('returns 0 for no match', () => {
    const result = fuzzyScore('xyz', 'users');
    expect(result.score).toBe(0);
  });

  it('returns match positions for exact match', () => {
    const result = fuzzyScore('users', 'users');
    expect(result.matches).toEqual([[0, 5]]);
  });

  it('returns match positions for prefix match', () => {
    const result = fuzzyScore('use', 'users');
    expect(result.matches).toEqual([[0, 3]]);
  });

  it('returns match positions for substring match', () => {
    const result = fuzzyScore('name', 'username');
    expect(result.matches).toEqual([[4, 8]]);
  });

  it('is case insensitive', () => {
    const upper = fuzzyScore('USERS', 'users');
    const lower = fuzzyScore('users', 'users');
    expect(upper.score).toBe(lower.score);
  });

  it('handles single character input', () => {
    const result = fuzzyScore('u', 'users');
    expect(result.score).toBeGreaterThan(0);
  });

  it('handles empty input', () => {
    const result = fuzzyScore('', 'users');
    expect(result.score).toBe(0);
  });
});

describe('scoreDotAware', () => {
  it('splits on dot and scores table and column parts', () => {
    const result = scoreDotAware('users.id', 'users', 'id');
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBe(100);
  });

  it('scores "dossieriso.row" highly against "llx_dossierisolation"/"rowid"', () => {
    const result = scoreDotAware(
      'dossieriso.row',
      'llx_dossierisolation',
      'rowid'
    );
    expect(result.score).toBeGreaterThan(50);
  });

  it('returns 0 when column part does not match', () => {
    const result = scoreDotAware('users.xyz', 'users', 'id');
    expect(result.score).toBe(0);
  });

  it('returns 0 when table part does not match', () => {
    const result = scoreDotAware('xyz.id', 'users', 'id');
    expect(result.score).toBe(0);
  });

  it('without dot, scores against table.column concatenation', () => {
    const result = scoreDotAware('usersid', 'users', 'id');
    expect(result.score).toBeGreaterThan(0);
  });

  it('is case insensitive with dot notation', () => {
    const result = scoreDotAware('USERS.ID', 'users', 'id');
    expect(result.score).toBe(100);
  });

  it('weights table at 0.6 and column at 0.4', () => {
    // Perfect table match (100) + perfect column match (100) = 0.6*100 + 0.4*100 = 100
    const perfect = scoreDotAware('users.id', 'users', 'id');
    expect(perfect.score).toBe(100);
  });
});

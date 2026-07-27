import { describe, it, expect } from 'vitest';
import { contrastRatio, wcagLevel } from '../contrast';

describe('contrastRatio', () => {
  it('black on white is the maximum 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('identical colors are 1:1', () => {
    expect(contrastRatio('#7f7f7f', '#7f7f7f')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#123456', '#abcdef')).toBeCloseTo(
      contrastRatio('#abcdef', '#123456'),
      5,
    );
  });
});

describe('wcagLevel', () => {
  it('classifies by WCAG thresholds for normal text', () => {
    expect(wcagLevel(21)).toBe('AAA');
    expect(wcagLevel(5)).toBe('AA');
    expect(wcagLevel(3.2)).toBe('AA Large');
    expect(wcagLevel(2.4)).toBe('Fail');
  });
});

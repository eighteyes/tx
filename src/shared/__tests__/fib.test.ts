import { describe, it, expect } from 'vitest';
import { fib, fibMemo, fibSequence } from '../fib';

describe('fib', () => {
  it('returns 0 for n=0', () => {
    expect(fib(0)).toBe(0);
  });

  it('returns 1 for n=1', () => {
    expect(fib(1)).toBe(1);
  });

  it('returns correct values for first 10 numbers', () => {
    const expected = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34];
    expected.forEach((val, i) => {
      expect(fib(i)).toBe(val);
    });
  });

  it('throws for negative numbers', () => {
    expect(() => fib(-1)).toThrow('Fibonacci is not defined for negative numbers');
  });
});

describe('fibMemo', () => {
  it('returns same results as iterative version', () => {
    for (let i = 0; i <= 20; i++) {
      expect(fibMemo(i)).toBe(fib(i));
    }
  });

  it('throws for negative numbers', () => {
    expect(() => fibMemo(-1)).toThrow('Fibonacci is not defined for negative numbers');
  });
});

describe('fibSequence', () => {
  it('returns empty array for n=0', () => {
    expect(fibSequence(0)).toEqual([]);
  });

  it('returns [0] for n=1', () => {
    expect(fibSequence(1)).toEqual([0]);
  });

  it('returns correct sequence for n=10', () => {
    expect(fibSequence(10)).toEqual([0, 1, 1, 2, 3, 5, 8, 13, 21, 34]);
  });
});

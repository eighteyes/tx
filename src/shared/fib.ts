/**
 * Fibonacci function implementations
 */

/**
 * Calculate the nth Fibonacci number (iterative approach)
 * @param n - The position in the Fibonacci sequence (0-indexed)
 * @returns The nth Fibonacci number
 */
export function fib(n: number): number {
  if (n < 0) {
    throw new Error('Fibonacci is not defined for negative numbers');
  }

  if (n === 0) return 0;
  if (n === 1) return 1;

  let prev = 0;
  let curr = 1;

  for (let i = 2; i <= n; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }

  return curr;
}

/**
 * Calculate the nth Fibonacci number (recursive with memoization)
 * @param n - The position in the Fibonacci sequence (0-indexed)
 * @param memo - Cache for memoization
 * @returns The nth Fibonacci number
 */
export function fibMemo(n: number, memo: Map<number, number> = new Map()): number {
  if (n < 0) {
    throw new Error('Fibonacci is not defined for negative numbers');
  }

  if (n === 0) return 0;
  if (n === 1) return 1;

  if (memo.has(n)) {
    return memo.get(n)!;
  }

  const result = fibMemo(n - 1, memo) + fibMemo(n - 2, memo);
  memo.set(n, result);

  return result;
}

/**
 * Generate Fibonacci sequence up to n terms
 * @param n - Number of terms to generate
 * @returns Array of Fibonacci numbers
 */
export function fibSequence(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];

  const sequence: number[] = [0, 1];

  for (let i = 2; i < n; i++) {
    sequence.push(sequence[i - 1] + sequence[i - 2]);
  }

  return sequence;
}

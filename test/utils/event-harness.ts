/**
 * EventHarness - Shared event collector for E2E tests
 *
 * Wraps a WorkerDispatcher, captures all emitted events into a queryable log.
 * Foundation for asserting on event sequences, waiting for specific events,
 * and verifying dispatcher behavior without real LLM calls.
 *
 * Responsibilities:
 * - Intercept all dispatcher events via emit() monkeypatch
 * - Provide waitForEvent() with timeout and criteria filtering
 * - Provide waitForEvents() for fan-out/ensemble multi-event collection
 * - Provide getEventPayloads() shorthand for data extraction
 * - Assert ordered event sequences
 * - Reset between test cases
 */

import { WorkerDispatcher } from '../../src/worker/dispatcher.ts';

export interface CapturedEvent {
  name: string;
  data: any;
  ts: number;
}

export class EventHarness {
  private events: CapturedEvent[] = [];
  private originalEmit: Function;
  private dispatcher: WorkerDispatcher;

  constructor(dispatcher: WorkerDispatcher) {
    this.dispatcher = dispatcher;
    this.originalEmit = dispatcher.emit.bind(dispatcher);

    // Monkeypatch emit to capture events before forwarding
    dispatcher.emit = (name: string | symbol, ...args: any[]): boolean => {
      const eventName = String(name);
      this.events.push({
        name: eventName,
        data: args[0],
        ts: Date.now(),
      });
      return this.originalEmit(name, ...args);
    };
  }

  /**
   * Wait for an event matching name and optional criteria.
   * Resolves with the matching event, rejects on timeout.
   */
  waitForEvent(
    name: string,
    criteria?: (data: any) => boolean,
    opts?: { timeout?: number; interval?: number }
  ): Promise<CapturedEvent> {
    const timeout = opts?.timeout ?? 30000;
    const interval = opts?.interval ?? 100;

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const check = () => {
        const match = this.events.find(
          (e) => e.name === name && (!criteria || criteria(e.data))
        );
        if (match) return resolve(match);

        if (Date.now() - startTime >= timeout) {
          const eventNames = this.events.map((e) => e.name);
          return reject(
            new Error(
              `Timeout (${timeout}ms) waiting for event "${name}". ` +
              `Captured events: [${eventNames.join(', ')}]`
            )
          );
        }

        setTimeout(check, interval);
      };

      check();
    });
  }

  /**
   * Return all captured events, optionally filtered by name.
   */
  getEvents(name?: string): CapturedEvent[] {
    if (!name) return [...this.events];
    return this.events.filter((e) => e.name === name);
  }

  /**
   * Wait for N events of the same type. Resolves with array of matching events
   * when count is reached, rejects on timeout. Uses same polling pattern as waitForEvent.
   */
  waitForEvents(
    name: string,
    count: number,
    opts?: { timeout?: number; interval?: number }
  ): Promise<CapturedEvent[]> {
    const timeout = opts?.timeout ?? 30000;
    const interval = opts?.interval ?? 100;

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const check = () => {
        const matches = this.events.filter((e) => e.name === name);
        if (matches.length >= count) return resolve(matches.slice(0, count));

        if (Date.now() - startTime >= timeout) {
          const eventNames = this.events.map((e) => e.name);
          return reject(
            new Error(
              `Timeout (${timeout}ms) waiting for ${count} events of type "${name}". ` +
              `Found ${matches.length}. ` +
              `Captured events: [${eventNames.join(', ')}]`
            )
          );
        }

        setTimeout(check, interval);
      };

      check();
    });
  }

  /**
   * Shorthand returning just the data arrays from events matching the given name.
   */
  getEventPayloads(name: string): any[] {
    return this.events.filter((e) => e.name === name).map((e) => e.data);
  }

  /**
   * Assert that events with the given names appeared in order.
   * Non-matching events between them are ignored (subsequence match).
   */
  assertEventSequence(names: string[]): void {
    let idx = 0;
    for (const event of this.events) {
      if (idx < names.length && event.name === names[idx]) {
        idx++;
      }
    }
    if (idx < names.length) {
      const actual = this.events.map((e) => e.name);
      throw new Error(
        `Event sequence assertion failed.\n` +
        `  Expected subsequence: [${names.join(', ')}]\n` +
        `  Matched ${idx}/${names.length} (stuck at "${names[idx]}")\n` +
        `  Actual events: [${actual.join(', ')}]`
      );
    }
  }

  /**
   * Clear all captured events.
   */
  reset(): void {
    this.events = [];
  }

  /**
   * Restore original emit (call in afterEach to avoid leaking).
   */
  destroy(): void {
    this.dispatcher.emit = this.originalEmit as any;
  }
}

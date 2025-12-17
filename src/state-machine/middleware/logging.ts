/**
 * Logging Middleware for State Machines
 *
 * Logs all state transitions for debugging and observability
 */

import { Middleware } from '../core/state-machine.ts';
import { log } from '../../shared/logger.ts';

export const createLoggingMiddleware = <S, C>(entityType: string): Middleware<S, C> => ({
  pre: async (from, to, transitionName, context) => {
    log.info('fsm', `Transition starting: ${transitionName}`, {
      entityId: (context as any).id,
      entityType,
      from: (from as any).status,
      to: (to as any).status
    });
  },

  post: async (from, to, transitionName, context) => {
    log.info('fsm', `Transition complete: ${transitionName}`, {
      entityId: (context as any).id,
      entityType,
      from: (from as any).status,
      to: (to as any).status,
      duration: Date.now() - ((to as any).startedAt || Date.now())
    });
  }
});
